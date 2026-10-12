// MIT. Source-preserving projections and comparisons; no provider calls.
import {canonical} from '../workspace.mjs';
import {researchIdentity} from '../analysis.mjs';
import {digest} from '../../node/store.mjs';
import {normalizeContract,readPointer,applyTransform,valueError,check} from './contract.mjs';

export function sourceFingerprint(e){return digest(canonical({edition:e.record,query:e.query.sha256,pages:e.pages.map(p=>({index:p.index,sha256:p.sha256,requestSha256:p.requestSha256})),decisions:e.decisions}));}
export function exceptionId({workId,field,code,source}){return digest(canonical({workId,field,code,source})).slice(0,32);}
export function projectEdition(edition,input,reviews={revision:0,items:{}}){
  const contract=normalizeContract(input);check(edition.query.entity==='works','FEED_WORKS_EDITION_REQUIRED');
  const fingerprint=sourceFingerprint(edition),rows=[],exceptions=[],omitted=[],fieldStats=Object.fromEntries(contract.fields.map(f=>[f.target,{field:f.target,present:0,absent:0,null:0,errors:0,resolved:0}]));
  const seen=new Map(),doiIds=new Map();let absoluteIndex=0;
  function issue(workId,field,code,source,raw,extra={}){
    const id=exceptionId({workId,field,code,source}),decision=reviews.items[id]??null;
    const row={id,workId,field,code,source,raw,...extra,resolution:decision,status:decision?'RESOLVED':'OPEN'};
    exceptions.push(row);return row;
  }
  for(const page of edition.pages)for(let pageRow=0;pageRow<page.records;pageRow++){
    const raw=edition.records[absoluteIndex++],workId=researchIdentity(raw?.id,{entity:'works'}),source={editionId:edition.record.id,queryId:edition.query.id,queryRevision:edition.query.revision,querySha256:edition.query.sha256,page:page.index,row:pageRow,recordPointer:'/results/'+pageRow,pageSha256:page.sha256,requestSha256:page.requestSha256,retrievedAt:page.source.retrievedAt,sourceUrl:page.source.url};
    if(!workId){issue(null,'_identity','MISSING_WORK_ID',source,{present:Object.hasOwn(raw??{},'id'),value:raw?.id??null});omitted.push({workId:null,reason:'MISSING_WORK_ID',source});continue;}
    if(seen.has(workId)){
      const first=seen.get(workId);if(canonical(first.raw)!==canonical(raw))issue(workId,'_record','DUPLICATE_CONFLICT',source,{present:true,value:raw},{firstSource:first.source});
      omitted.push({workId,reason:'DUPLICATE_OCCURRENCE',source});continue;
    }
    seen.set(workId,{raw,source});
    const originalReview=edition.decisions.items[workId]??{status:'undecided',notes:'',tags:[]};
    if(originalReview.status==='exclude'||contract.selection==='included'&&originalReview.status!=='include'){
      omitted.push({workId,reason:originalReview.status==='exclude'?'RESEARCH_REVIEW_EXCLUDED':'RESEARCH_REVIEW_NOT_INCLUDED',source});continue;
    }
    const mapped={},recordExceptions=[];
    for(const field of contract.fields){
      const stat=fieldStats[field.target],found=readPointer(raw,field.source);stat[found.present?'present':'absent']++;if(found.present&&found.value===null)stat.null++;
      let value,include=true,code=null;
      if(!found.present){include=field.missing==='null';value=null;code=field.required?'REQUIRED_FIELD_ABSENT':include?valueError(value,field):null;}
      else{
        const transformed=applyTransform(found.value,field);value=transformed.value;code=transformed.error??valueError(value,field);
        if(found.missingElements)code=code??'ARRAY_ELEMENT_FIELD_ABSENT';
      }
      if(code){
        const ex=issue(workId,field.target,code,source,{present:found.present,value:found.present?found.value:null},{sourceField:field.source});recordExceptions.push(ex);stat.errors++;
        if(ex.resolution){
          const decision=ex.resolution;
          if(decision.action==='replace'){value=decision.value;include=true;}
          else if(decision.action==='omit'){include=false;}
          stat.resolved++;
        }
      }
      if(include&&value!==undefined)mapped[field.target]=value;
    }
    const excluded=recordExceptions.some(e=>e.resolution?.action==='exclude');
    if(excluded){omitted.push({workId,reason:'FEED_REVIEW_EXCLUDED',source});continue;}
    mapped._source={...source,sourceFingerprint:fingerprint};mapped._review=originalReview;
    rows.push({workId,data:mapped,exceptionIds:recordExceptions.map(x=>x.id),openExceptions:recordExceptions.filter(x=>x.status==='OPEN').length,source});
    const rawDoi=readPointer(raw,'/doi');if(rawDoi.present&&rawDoi.value!==null){const normalized=applyTransform(rawDoi.value,{transform:'doi-key'});if(normalized.value){const ids=doiIds.get(normalized.value)??[];ids.push(workId);doiIds.set(normalized.value,ids);}}
  }
  // Excluding a source work resolves all its field errors without changing the source.
  const excludedWorks=new Set(omitted.filter(x=>x.reason==='FEED_REVIEW_EXCLUDED').map(x=>x.workId));
  for(const ex of exceptions)if(ex.status==='OPEN'&&excludedWorks.has(ex.workId)){ex.status='EXCLUDED';}
  const doiCollisions=[...doiIds.entries()].filter(([,ids])=>new Set(ids).size>1).map(([doi,workIds])=>({doi,workIds:[...new Set(workIds)]}));
  const open=exceptions.filter(x=>x.status==='OPEN');
  return {schema:'stellar-forge.research-feed-projection.v1',contract,sourceFingerprint:fingerprint,edition:{record:edition.record,query:edition.query,coverage:edition.coverage},reviewRevision:reviews.revision,
    summary:{sourceRecords:edition.records.length,uniqueWorks:seen.size,outputRecords:rows.length,omittedRecords:omitted.length,exceptions:exceptions.length,openExceptions:open.length,resolvedExceptions:exceptions.length-open.length,doiCollisions:doiCollisions.length,ready:open.length===0&&(edition.coverage.state==='COMPLETE'||contract.allowPartial)},
    rows,exceptions,omitted,fieldStats:Object.values(fieldStats),doiCollisions};
}
export function compareProjections(before,after){
  const left=new Map(before.rows.map(r=>[r.workId,r])),right=new Map(after.rows.map(r=>[r.workId,r])),added=[],removed=[],changed=[],unchanged=[];
  for(const [id,b] of left){
    const a=right.get(id);if(!a){removed.push({workId:id,before:b.data,beforeSource:b.source});continue;}
    const fields=[];for(const key of new Set([...Object.keys(b.data),...Object.keys(a.data)])){
      if(key==='_source')continue;
      const bp=Object.hasOwn(b.data,key),ap=Object.hasOwn(a.data,key);if(bp!==ap||bp&&canonical(b.data[key])!==canonical(a.data[key]))fields.push({field:key,before:{present:bp,value:bp?b.data[key]:null},after:{present:ap,value:ap?a.data[key]:null}});
    }
    if(fields.length)changed.push({workId:id,fields,beforeSource:b.source,afterSource:a.source});else unchanged.push(id);
  }
  for(const [id,a] of right)if(!left.has(id))added.push({workId:id,after:a.data,afterSource:a.source});
  return {schema:'stellar-forge.research-feed-comparison.v1',before:{edition:before.edition,sourceFingerprint:before.sourceFingerprint,summary:before.summary},after:{edition:after.edition,sourceFingerprint:after.sourceFingerprint,summary:after.summary},contract:after.contract,
    summary:{added:added.length,removed:removed.length,changed:changed.length,unchanged:unchanged.length,sameQuery:before.edition.query.sha256===after.edition.query.sha256,bothComplete:before.edition.coverage.state==='COMPLETE'&&after.edition.coverage.state==='COMPLETE'},added,removed,changed,unchanged};
}
function csvCell(value){
  let text=value===undefined?'':value===null?'null':typeof value==='object'?JSON.stringify(value):String(value);
  if(/^[\t\r\n ]*[=+@-]/u.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function csv(rows,fields){return fields.map(csvCell).join(',')+'\r\n'+rows.map(row=>fields.map(key=>csvCell(row[key])).join(',')).join('\r\n')+(rows.length?'\r\n':'');}
export function feedCSV(projection){return csv(projection.rows.map(row=>row.data),[...projection.contract.fields.map(f=>f.target),'_source','_review']);}
export function feedJSONL(projection){return projection.rows.map(row=>JSON.stringify(row.data)+'\n').join('');}
