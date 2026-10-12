// MIT. Shared contract for an attachment to the original authenticated Research workspace.
import {createHash} from 'node:crypto';
import {need,object} from '../node/store.mjs';
import {inspectResearchSources,inspectResearchComparison} from './source-inspection.mjs';

import {RESEARCH_WORKSPACE_API,RESEARCH_WORKSPACE_CONNECTION,RESEARCH_SECTIONS,RESEARCH_PAGE_LIMIT,RESEARCH_CONTROL_LIMIT,RESEARCH_COMPARISON_SECTIONS} from './workspace-contracts.mjs';
export {RESEARCH_WORKSPACE_API,RESEARCH_WORKSPACE_CONNECTION,RESEARCH_SECTIONS,RESEARCH_PAGE_LIMIT,RESEARCH_CONTROL_LIMIT,RESEARCH_COMPARISON_SECTIONS} from './workspace-contracts.mjs';
export const researchWorkspaceId = directory => 'research_' + createHash('sha256').update(directory).digest('hex');
export const researchSummary = value => Object.fromEntries(
  ['schema','id','title','description','revision','createdAt','updatedAt','questionCount','editionCount','selectedCount','findingCount']
    .filter(key => Object.hasOwn(value,key)).map(key => [key,value[key]]));
export const researchRevision = value => {
  need(Number.isSafeInteger(value)&&value>=1&&value<100000000,'REVISION_INVALID');return value;
};
export function researchPage(values,{offset=0,limit=30}={}){
  need(Array.isArray(values)&&Number.isSafeInteger(offset)&&offset>=0&&offset<=values.length&&
    Number.isSafeInteger(limit)&&limit>=1&&limit<=RESEARCH_PAGE_LIMIT,'RESEARCH_PAGE_INVALID');
  const items=values.slice(offset,offset+limit),nextOffset=offset+items.length<values.length?offset+items.length:null;
  return {offset,limit,total:values.length,items,nextOffset,complete:nextOffset===null};
}
export function researchConnection(value){
  need(object(value)&&typeof value.url==='string'&&value.url.length<=2048,'RESEARCH_CONNECTION_INVALID');
  let url;try{url=new URL(value.url);}catch{need(false,'RESEARCH_CONNECTION_INVALID');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/'&&
    !url.username&&!url.password&&!url.search&&/^#token=[a-f0-9]{64}$/.test(url.hash),'RESEARCH_CONNECTION_INVALID');
  need(value.schema===undefined||value.schema===RESEARCH_WORKSPACE_CONNECTION,'RESEARCH_CONNECTION_INVALID');
  need(value.mode===undefined||value.mode==='RESEARCH_DOSSIER_WORKSPACE','RESEARCH_CONNECTION_INVALID');
  need(value.workspaceId===undefined||/^research_[a-f0-9]{64}$/.test(value.workspaceId),'RESEARCH_CONNECTION_INVALID');
  need(value.instanceId===undefined||/^[a-f0-9-]{36}$/.test(value.instanceId),'RESEARCH_CONNECTION_INVALID');
  return {origin:url.origin,token:url.hash.slice(7),workspaceId:value.workspaceId,instanceId:value.instanceId};
}
export async function researchSection(store,id,{section,revision,offset=0,limit=30,questionId,query='',selected}={}){
  need(RESEARCH_SECTIONS.includes(section),'RESEARCH_SECTION_INVALID');
  need(typeof query==='string'&&query.length<=1000,'RESEARCH_QUERY_INVALID');
  need(selected===undefined||typeof selected==='boolean','RESEARCH_SELECTION_INVALID');
  need(questionId===undefined||typeof questionId==='string'&&/^q_[a-f0-9-]{36}$/.test(questionId),'QUESTION_NOT_FOUND');
  if(revision!==undefined)researchRevision(revision);
  need(offset===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
  const metadata=await store.getMetadata(id,{revision});
  if(questionId!==undefined)need(metadata.questions.some(row=>row.id===questionId),'QUESTION_NOT_FOUND');
  let values;
  if(section==='sources'){
    const view=await store.get(id,{revision:metadata.revision,references:false,includeHistory:false});
    values=inspectResearchSources(view.sources).filter(row=>(questionId===undefined||row.citations.some(c=>c.questionId===questionId))&&
      (selected===undefined||row.selected===selected));
  }else if(section==='revisions'){
    need(questionId===undefined&&selected===undefined&&!query,'RESEARCH_FILTER_INVALID');
    values=await store.listRevisions(id,{revision:metadata.revision});
  }else{
    need(selected===undefined||section==='selections','RESEARCH_FILTER_INVALID');
    values=metadata[section].filter(row=>(questionId===undefined||(section==='questions'?row.id:row.questionId)===questionId)&&
      (selected===undefined||row.selected===selected));
  }
  if(query){const text=query.toLocaleLowerCase();values=values.filter(row=>JSON.stringify(row).toLocaleLowerCase().includes(text));}
  const page=researchPage(values,{offset,limit});
  return {dossier:researchSummary(metadata),section,revision:metadata.revision,...page,
    next:page.nextOffset===null?null:{revision:metadata.revision,offset:page.nextOffset,limit}};
}

export function researchComparison(value,{section='overview',offset=0,limit=30}={}){
  value=inspectResearchComparison(value);
  const sections={added:value.added,removed:value.removed,changed:value.changed,questions:value.questions,
    editions:value.editions,availability:value.availability,'findings-added':value.findings.added,
    'findings-removed':value.findings.removed,'findings-changed':value.findings.changed};
  need(section==='overview'||RESEARCH_COMPARISON_SECTIONS.includes(section),'RESEARCH_COMPARISON_SECTION_INVALID');
  return {before:value.before,after:value.after,counts:Object.fromEntries(Object.entries(sections).map(([key,rows])=>[key,rows.length])),
    section,...(section==='overview'?{}:{page:researchPage(sections[section],{offset,limit})})};
}
export function researchCrossrefReview(value,{section='overview',offset=0,limit=30}={}){
  need(['overview','dois','records','added','removed','changed','warnings'].includes(section),'RESEARCH_CROSSREF_SECTION_INVALID');
  const {dois,...payload}=value.plan.payload;
  const plan={...value.plan,payload:{...payload,doiCount:dois.length}};
  const result={...value,plan,review:value.review?{
    coverage:value.review.coverage,usage:value.review.usage,recordCount:value.review.records.length,
    warningCount:value.review.warnings.length,comparison:{
      schema:value.review.comparison.schema,before:value.review.comparison.before,after:value.review.comparison.after,
      added:value.review.comparison.added.length,removed:value.review.comparison.removed.length,
      changed:value.review.comparison.changed.length}}:null,section};
  if(section==='overview')return result;
  const rows=section==='dois'?dois:section==='records'?value.review?.records:section==='warnings'?value.review?.warnings:
    value.review?.comparison[section];
  need(Array.isArray(rows),'CROSSREF_EDITION_NOT_READY');
  return {...result,page:researchPage(rows,{offset,limit})};
}
