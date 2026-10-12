// SPDX-License-Identifier: MIT
// Agent actions over the original Analysis Research intake service.
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';

const SCHEMA='stellar-forge.analysis-research-intake.v1';
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const JOB=/^[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;
const WORKSPACE=/^research_[a-f0-9]{64}$/;
// Preserve the original Research dossier ID, including its UUID hyphens.
const DOSSIER=/^d_[a-f0-9-]{36}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
const operations=new Set(['research-connections','research-dossiers','research-sources',
  'research-review','research-elements','research-capture','research-captures','research-cancel']);
const error=suffix=>'MCP_ANALYSIS_RESEARCH_'+suffix;
function string(value,pattern,code){need(typeof value==='string'&&pattern.test(value),error(code));return value;}
function integer(value,minimum,maximum=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=minimum&&value<=maximum,error('PAGE_OR_REVISION_INVALID'));return value;
}
function text(value,maximum,{empty=false}={}){
  need(typeof value==='string'&&Array.from(value).length<=maximum
    &&(empty||value.trim().length>0)&&!(/[\x00-\x1f\x7f]/.test(value)),error('TEXT_INVALID'));return value;
}
function fields(value,required,optional=[]){
  need(object(value)&&required.every(key=>Object.hasOwn(value,key))
    &&Object.keys(value).every(key=>required.includes(key)||optional.includes(key)),error('FIELDS_INVALID'));
}
function selection(family,value){
  need(['documents','pipelines'].includes(family)&&object(value),error('SELECTION_INVALID'));
  const keys=Object.keys(value);
  if(keys.length===1&&Object.hasOwn(value,'editionId'))
    string(value.editionId,/^e_[a-f0-9]{64}$/,'EDITION_ID_REQUIRED');
  else if(family==='documents'&&keys.length===1&&Object.hasOwn(value,'purchaseId'))
    string(value.purchaseId,/^u_[a-f0-9]{64}$/,'PURCHASE_ID_REQUIRED');
  else if(family==='pipelines'&&keys.length===2&&Object.hasOwn(value,'operationId')&&Object.hasOwn(value,'outputId')){
    string(value.operationId,/^up_[a-f0-9]{64}$/,'OPERATION_ID_REQUIRED');
    string(value.outputId,/^out_[a-f0-9]{64}$/,'OUTPUT_ID_REQUIRED');
  }else need(false,error('ONE_NATIVE_SELECTION_REQUIRED'));
}
function common(body,{dossier=false,selected=false}={}){
  string(body.connection,NAME,'CONNECTION_ALIAS_REQUIRED');
  string(body.expected_workspace_id,WORKSPACE,'WORKSPACE_ID_REQUIRED');
  if(dossier){
    string(body.dossier_id,DOSSIER,'DOSSIER_ID_REQUIRED');
    need(['documents','pipelines'].includes(body.family),error('FAMILY_INVALID'));
  }
  if(selected)selection(body.family,body.selection);
}
function query(values){
  const pairs=Object.entries(values).filter(([,value])=>value!==undefined);
  return pairs.length?'?'+new URLSearchParams(pairs.map(([key,value])=>[key,String(value)])):'';
}
function bound(value,body){
  need(object(value)&&value.connection===body.connection&&value.workspace_id===body.expected_workspace_id
    &&Object.hasOwn(value,'result'),error('RESEARCH_WORKSPACE_CHANGED'));
  if(body.dossier_id!==undefined)need(value.dossier_id===body.dossier_id&&value.family===body.family,
    error('DOSSIER_SELECTION_CHANGED'));
  return value;
}

/** Preserve the original job and source identity while applying the existing host path projection. */
export function publicNativeResearchJob(job,publicSource){
  if(!object(job)||job.kind!=='research-capture')return job;
  const result={...job};
  if(object(job.result)){
    result.result={...job.result};
    if(object(job.result.source)){
      need(typeof publicSource==='function',error('SOURCE_PROJECTION_REQUIRED'));
      result.result.source=publicSource(job.result.source);
    }
  }
  return result;
}

/** All transports and call/close ownership come from the original Analysis adapter. */
export function createNativeResearchActions({publicJob}={}){
  need(typeof publicJob==='function',error('ORIGINAL_JOB_PROJECTION_REQUIRED'));
  function job(value,identifier){
    need(object(value)&&value.id===identifier&&value.kind==='research-capture',error('ORIGINAL_CAPTURE_JOB_REQUIRED'));
    return publicJob(value);
  }
  return {
    handles:operation=>operations.has(operation),
    async call({operation,body,get,post}){
      need(operations.has(operation)&&object(body)&&typeof get==='function'&&typeof post==='function',
        error('ORIGINAL_TRANSPORT_REQUIRED'));
      if(operation==='research-connections'){
        fields(body,[]);
        const value=await get('/api/research-connections');
        need(value?.schema===SCHEMA&&typeof value.configured==='boolean'&&typeof value.can_capture==='boolean'
          &&Array.isArray(value.connections)&&value.connections.length<=64,error('CONNECTION_LIST_INVALID'));
        const names=new Set(),connections=value.connections.map(item=>{
          need(object(item),error('CONNECTION_LIST_INVALID'));
          string(item.name,NAME,'CONNECTION_ALIAS_REQUIRED');string(item.workspace_id,WORKSPACE,'WORKSPACE_ID_REQUIRED');
          text(item.label,160);need(!names.has(item.name),error('CONNECTION_ALIAS_DUPLICATED'));names.add(item.name);
          return {name:item.name,label:item.label,workspace_id:item.workspace_id};
        });
        return {schema:value.schema,configured:value.configured,can_capture:value.can_capture,connections};
      }
      if(operation==='research-captures'){
        fields(body,[],['before','limit']);
        if(body.before!==undefined)integer(body.before,1);
        if(body.limit!==undefined)integer(body.limit,1,100);
        const value=await get('/api/research-captures'+query(body));
        need(object(value)&&Array.isArray(value.captures),error('CAPTURE_HISTORY_INVALID'));
        if(value.next_before!==null&&value.next_before!==undefined)integer(value.next_before,1);
        return {...value,captures:value.captures.map(item=>job(item,string(item?.id,JOB,'CAPTURE_ID_REQUIRED')))};
      }
      if(operation==='research-cancel'){
        fields(body,['id']);string(body.id,JOB,'CAPTURE_ID_REQUIRED');
        return job(await post('/api/research-captures/'+body.id+'/cancel',{}),body.id);
      }
      const required=['connection','expected_workspace_id'];
      if(operation==='research-dossiers'){
        fields(body,required,['offset','limit','snapshot']);common(body);
        const offset=body.offset??0;integer(offset,0);
        if(body.limit!==undefined)integer(body.limit,1,100);
        if(body.snapshot!==undefined)string(body.snapshot,HASH,'INVENTORY_SNAPSHOT_REQUIRED');
        need(offset===0||body.snapshot!==undefined,error('INVENTORY_SNAPSHOT_REQUIRED'));
        // The original snapshot and next cursor are returned unchanged.
        return bound(await post('/api/research-dossiers',copy(body)),body);
      }
      required.push('dossier_id','family');
      if(operation==='research-sources'){
        fields(body,required,['after','limit']);common(body,{dossier:true});
        if(body.after!==undefined){
          need(typeof body.after==='string',error('SOURCE_CURSOR_INVALID'));
          if(body.after)string(body.after,body.family==='documents'?/^u_[a-f0-9]{64}$/:/^up_[a-f0-9]{64}$/,
            'SOURCE_CURSOR_INVALID');
        }
        if(body.limit!==undefined)integer(body.limit,1,100);
        return bound(await post('/api/research-sources',copy(body)),body);
      }
      required.push('selection');
      if(operation==='research-review'){
        fields(body,required);common(body,{dossier:true,selected:true});
        return bound(await post('/api/research-review',copy(body)),body);
      }
      required.push('expected_edition_sha256');
      if(operation==='research-elements'){
        fields(body,required,['offset','limit','page','type','query']);common(body,{dossier:true,selected:true});
        string(body.expected_edition_sha256,HASH,'EDITION_DIGEST_REQUIRED');
        if(body.offset!==undefined)integer(body.offset,0);
        if(body.limit!==undefined)integer(body.limit,1,100);
        for(const [key,maximum]of [['page',100],['type',200],['query',2000]])
          if(body[key]!==undefined)text(body[key],maximum,{empty:true});
        return bound(await post('/api/research-elements',copy(body)),body);
      }
      need(operation==='research-capture',error('OPERATION_INVALID'));
      fields(body,[...required,'id','name','expected_revision','title','captured_at']);
      common(body,{dossier:true,selected:true});
      string(body.id,JOB,'CAPTURE_ID_REQUIRED');string(body.expected_edition_sha256,HASH,'EDITION_DIGEST_REQUIRED');
      string(body.name,NAME,'SOURCE_ALIAS_REQUIRED');integer(body.expected_revision,0);
      text(body.title,160);string(body.captured_at,TIME,'CAPTURE_TIME_REQUIRED');
      // Calendar validity and exact captured-source binding remain enforced by
      // the original Python intake before its immutable native job admission.
      return job(await post('/api/start/research-capture',copy(body)),body.id);
    }
  };
}
