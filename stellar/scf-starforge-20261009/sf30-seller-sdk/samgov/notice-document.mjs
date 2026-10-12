// MIT. Original SAM website notice, attachment index and history representations.
import {
  plain,copy,canonical,sha,text,identifier,requireThat,cleanSourceUrl,noticeRow,
} from './core.mjs';

export const NOTICE_DOCUMENT_FORMAT='samgov_notice_document.v1';
export const NOTICE_DOCUMENT_BASIS='retained_notice_document';
const KIND_PATH={notice_record:['v2',''],notice_resources:['v3','/resources'],notice_history:['v2','/history']};
function noticeId(value){
  const id=identifier(value,'SAM notice ID');
  requireThat(/^[a-f0-9]{32}$/i.test(id),'NOTICE_DOCUMENT_ID_INVALID');
  return id;
}
export function noticeDocumentUrls(id){
  id=noticeId(id);
  return {
    notice:'https://sam.gov/api/prod/opps/v2/opportunities/'+id,
    resources:'https://sam.gov/api/prod/opps/v3/opportunities/'+id+'/resources?withScanResult=false&excludeDeleted=false',
    history:'https://sam.gov/api/prod/opps/v2/opportunities/'+id+'/history',
  };
}
export function validateNoticeDocumentUrl(value,kind,id){
  const path=KIND_PATH[kind];requireThat(path,'NOTICE_DOCUMENT_KIND_INVALID');
  const url=new URL(cleanSourceUrl(value));id=noticeId(id);
  requireThat(url.origin==='https://sam.gov' &&
    url.pathname==='/api/prod/opps/'+path[0]+'/opportunities/'+id+path[1],
    'NOTICE_DOCUMENT_URL_CHANGED','Use the original SAM notice, resource-index or history URL for this notice.');
  const allowed=kind==='notice_resources'?new Set(['withScanResult','excludeDeleted']):
    kind==='notice_history'?new Set(['postedFrom']):new Set();
  const seen=new Set();
  for(const [key,item] of url.searchParams){
    requireThat(allowed.has(key) && !seen.has(key),'NOTICE_DOCUMENT_QUERY_INVALID');seen.add(key);
    if(kind==='notice_resources')requireThat(['true','false'].includes(item),'NOTICE_DOCUMENT_QUERY_INVALID');
  }
  return url.href;
}
export function parseNoticeDocument(value){
  requireThat(plain(value) && plain(value.data2),'NOTICE_DOCUMENT_INVALID',
    'Receive the original SAM notice response containing data2.');
  const id=noticeId(value.opportunityId??value.id);
  if(value.id!==undefined)requireThat(value.id===id,'NOTICE_DOCUMENT_ID_CHANGED');
  if(value.opportunityId!==undefined)requireThat(value.opportunityId===id,'NOTICE_DOCUMENT_ID_CHANGED');
  const self=value._links?.self?.href;
  if(self){
    const url=new URL(self,'https://sam.gov');
    requireThat(url.pathname==='/opps/v2/opportunities/'+id ||
      url.pathname==='/api/prod/opps/v2/opportunities/'+id,'NOTICE_DOCUMENT_SELF_CHANGED');
  }
  requireThat(typeof value.data2.title==='string','NOTICE_DOCUMENT_TITLE_REQUIRED');
  if(value.description!==undefined){
    requireThat(Array.isArray(value.description),'NOTICE_DOCUMENT_DESCRIPTION_INVALID');
    for(const item of value.description)requireThat(plain(item) &&
      (item.opportunityId===undefined || item.opportunityId===id) &&
      (item.body===undefined || typeof item.body==='string'),'NOTICE_DOCUMENT_DESCRIPTION_INVALID');
  }
  return {id,value};
}
function attachmentRows(index,id){
  if(index===null || index===undefined)return [];
  requireThat(plain(index) && Array.isArray(index._embedded?.opportunityAttachmentList),
    'NOTICE_RESOURCE_INDEX_INVALID');
  const groups=index._embedded.opportunityAttachmentList;
  requireThat(groups.every(group=>plain(group) && group.opportunityId===id &&
    Array.isArray(group.attachments)),'NOTICE_RESOURCE_INDEX_ID_CHANGED');
  const rows=groups.flatMap((group,groupIndex)=>group.attachments.map((item,itemIndex)=>{
    requireThat(plain(item),'NOTICE_RESOURCE_INDEX_ROW_INVALID');
    if(item.type==='file')noticeId(item.resourceId);
    return {...copy(item),sourcePointer:'/_embedded/opportunityAttachmentList/'+groupIndex+'/attachments/'+itemIndex};
  }));
  requireThat(new Set(rows.filter(row=>row.resourceId).map(row=>row.resourceId)).size===
    rows.filter(row=>row.resourceId).length,'NOTICE_RESOURCE_INDEX_DUPLICATE');
  return rows;
}
function historyRows(history,id,parent){
  if(history===null || history===undefined)return [];
  requireThat(plain(history) && Array.isArray(history.history),'NOTICE_HISTORY_INVALID');
  const rows=history.history;
  for(const item of rows)requireThat(plain(item) &&
    /^[a-f0-9]{32}$/i.test(item.opportunityId??'') &&
    (item.opportunityId===id || item.parentOpportunityId===id ||
      (typeof parent==='string' && /^[a-f0-9]{32}$/i.test(parent) &&
        (item.opportunityId===parent || item.parentOpportunityId===parent))),'NOTICE_HISTORY_ID_CHANGED');
  return rows.map((row,index)=>({...copy(row),sourcePointer:'/history/'+index}));
}
const asIssued=value=>value===undefined || value===null?null:typeof value==='string'?value:String(value);
function originalResourceUrl(item){
  if(item.deletedFlag==='1' || item.deletedFlag===true || item.deletedDate)return null;
  if(item.type==='file' && item.resourceId)
    return 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/'+item.resourceId+'/download';
  if(item.type==='link' && typeof item.url==='string')return cleanSourceUrl(item.url);
  return null;
}
export function noticeDocumentRow(document,source,resources=[]){
  const {id,value}=parseNoticeDocument(document.notice),data=value.data2;
  requireThat(source?.format===NOTICE_DOCUMENT_FORMAT && source.rowPointer==='',
    'NOTICE_DOCUMENT_SOURCE_INVALID');
  const attachments=attachmentRows(document.resources,id);
  const history=historyRows(document.history,id,value.parent?.opportunityId);
  const deadline=data.solicitation?.deadlines;
  const naics=Array.isArray(data.naics)?data.naics.flatMap(row=>
    Array.isArray(row.code)?row.code:row.code===undefined?[]:[row.code]).map(asIssued):[];
  const links=attachments.map(originalResourceUrl).filter(Boolean);
  const projection={
    noticeId:id,title:data.title,solicitationNumber:data.solicitationNumber,
    fullParentPathName:data.fullParentPathName,fullParentPathCode:data.fullParentPathCode,
    postedDate:value.postedDate,type:data.type,baseType:data.baseType,active:value.status?.code,
    responseDeadLine:deadline?.response,archiveDate:data.archive?.date,archiveType:data.archive?.type,
    naicsCode:naics.length?naics.join(', '):null,classificationCode:data.classificationCode,
    typeOfSetAside:data.solicitation?.setAside,
    typeOfSetAsideDescription:data.solicitation?.setAsideDescription,
    uiLink:'https://sam.gov/workspace/contract/opp/'+id+'/view',
    resourceLinks:links,award:data.award,pointOfContact:data.pointOfContact,
    placeOfPerformance:data.placeOfPerformance,
  };
  const result=noticeRow(projection,source,resources);
  result.raw=copy(value);
  result.documentResources=document.resources===undefined?null:copy(document.resources);
  result.documentHistory=document.history===undefined?null:copy(document.history);
  result.organizationId=asIssued(data.organizationId);
  result.issuedTimeZone=asIssued(deadline?.responseTz);
  result.publicationState={status:copy(value.status??null),latest:value.latest??null,
    archived:value.archived??null,cancelled:value.cancelled??null,deleted:value.deleted??null,
    postedDate:asIssued(value.postedDate),modifiedDate:asIssued(value.modifiedDate),
    parentNoticeId:asIssued(value.parent?.opportunityId)};
  result.descriptions=(value.description??[]).map((item,index)=>({
    body:item.body??'',sourceId:source.sourceId,rowPointer:'/description/'+index+'/body',
    descriptionId:item.descriptionId??null,modifiedOn:item.modifiedOn??null}));
  result.attachmentIndex=attachments.map(item=>({...item,url:originalResourceUrl(item)}));
  result.noticeHistory=history;
  const retained=resources.map(item=>({kind:item.kind,url:item.url,sha256:item.sha256,
    bytes:item.bytes,status:item.status})).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  result.recordSha256=sha({format:NOTICE_DOCUMENT_FORMAT,notice:value,
    resources:result.documentResources,history:result.documentHistory,retained});
  return result;
}
export function rebuildNotice(row,resources=row.resources){
  if(row.source?.format!==NOTICE_DOCUMENT_FORMAT)return noticeRow(row.raw,row.source,resources);
  return noticeDocumentRow({notice:row.raw,resources:row.documentResources,
    history:row.documentHistory},row.source,resources);
}
export function noticeSourceIds(row,{successfulResourcesOnly=false}={}){
  return [...new Set([
    row.source.sourceId,...(row.source.companions??[]).map(item=>item.sourceId),
    ...row.resources.filter(item=>!successfulResourcesOnly ||
      item.status===200 || item.status==='received_file').map(item=>item.sourceId),
  ].filter(Boolean))];
}
