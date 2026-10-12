// MIT. Review registered Crossref notices against the original saved dossier.
// Relationship direction: notice.DOI updates each update-to[].DOI.
// https://github.com/CrossRef/rest-api-doc/blob/master/api_format.md#update
import {digest,jsonBytes,need,object} from '../node/store.mjs';
import {normalizeDoi,dateLabel} from '../../sf30-seller-sdk/crossref/metadata.mjs';
import {validateCrossrefEdition} from './crossref.mjs';
import {validateCrossrefDocumentEdition} from './crossref-documents.mjs';

export const CITATION_REVIEW_SCHEMA='sf88-citation-update-review.v1';
export const CITATION_DECISIONS=Object.freeze(['retain','revise','exclude','follow-up']);
export const FINDING_DISPOSITIONS=Object.freeze(['unchanged','revised','citation-removed','follow-up']);
const clone=value=>structuredClone(value);
const array=value=>Array.isArray(value)?value:[];
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const citationDigest=value=>digest(jsonBytes(canonical(value)));
const doi=value=>{try{return normalizeDoi(value);}catch{return null;}};
const text=(value,code,max,empty=false)=>{
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),code);return value;
};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const occurrence=value=>typeof value==='string'&&/^o_[a-f0-9]{64}$/.test(value);
const finding=value=>typeof value==='string'&&/^f_[a-f0-9-]{36}$/.test(value);
const same=(left,right)=>citationDigest(left)===citationDigest(right);
const fields=(value,names)=>Object.fromEntries(names.map(key=>[key,value[key]]));
const SELECTION_FIELDS=['occurrenceId','editionId','questionId','key','selected','classification','note','updatedAt'];
const FINDING_FIELDS=['id','questionId','title','text','occurrenceIds','createdAt','updatedAt'];
function defined(value){return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));}
const selectionSnapshot=value=>defined(fields(value,SELECTION_FIELDS));
const findingSnapshot=value=>defined(fields(value,FINDING_FIELDS));
function meaningfulRecord(work,relations){
  // Index/deposit time and citation counters do not change an editorial notice.
  // All original values and assertion ordering remain in the retained response.
  const value=Object.fromEntries(Object.entries(work).filter(([key])=>
    !['indexed','deposited','created','score','is-referenced-by-count','reference-count','references-count','update-to'].includes(key)));
  return {...value,'update-to':relations};
}
function registeredAssertions(relations){
  const unique=new Map();
  for(const relation of relations)unique.set(citationDigest(relation),clone(relation));
  return [...unique.entries()].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([,value])=>value);
}
export function citationNoticeSnapshot(notice){
  return Object.fromEntries(['noticeId','noticeDoi','targetDoi','type','label','title','date',
    'noticeVersion','registeredUpdate','registeredUpdates','latestSource','noticeSources','versions']
    .map(key=>[key,clone(notice[key])]));
}
function brief(review){
  if(!review)return null;
  return fields(review,['id','requestId','actor','decision','reason','createdAt','originalRevision','revision','beforeFingerprint','afterFingerprint']);
}

/** Derive links from verified original envelopes, including notices acquired in another question. */
export function citationUpdateModel(state,projected){
  need(object(state)&&projected instanceof Map,'CITATION_DOSSIER_REQUIRED');
  const notices=new Map(),coverage=[],occurrences=new Map();
  for(const edition of state.editions){
    const projection=projected.get(edition.id);
    for(const row of projection?.items??[]){
      const occurrenceId='o_'+digest(Buffer.from(edition.id+'\n'+row.key));
      const selected=state.selections.find(item=>item.occurrenceId===occurrenceId);
      occurrences.set(occurrenceId,{occurrenceId,editionId:edition.id,questionId:edition.questionId,key:row.key,
        title:row.title,doi:doi(row.doi),retained:edition.mode==='retained',
        selected:selected?.selected??false,classification:selected?.classification??'unreviewed',
        note:selected?.note??'',...(selected?.updatedAt?{updatedAt:selected.updatedAt}:{})});
    }
    const raw=projection?.raw;
    const documentEdition=raw?.provider==='crossref-document'||(!raw&&edition.provider==='crossref-document');
    const isCrossref=documentEdition||raw?.provider==='crossref'||projection?.provider==='crossref'||
      edition.provider==='crossref'||edition.provider==='crossref-document';
    if(!isCrossref)continue;
    const observed={editionId:edition.id,questionId:edition.questionId,label:edition.label,createdAt:edition.createdAt,
      sourceSha256:edition.raw?.sha256??null,sourceKind:documentEdition?'retained-document':'http-capture',
      coverage:'UNAVAILABLE',updatesLookup:'NOT_RETAINED',
      requestedDois:[],updateRequestedDois:[],missingUpdates:[],issues:[]};
    coverage.push(observed);
    if(edition.mode!=='retained'){
      observed.issues.push('CROSSREF_REFERENCE_ONLY');continue;
    }
    try{documentEdition?validateCrossrefDocumentEdition(raw):validateCrossrefEdition(raw);}
    catch(error){observed.issues.push(error.code??'CROSSREF_ORIGINAL_CAPTURE_REQUIRED');continue;}
    Object.assign(observed,{coverage:raw.usage.coverage,updatesLookup:raw.usage.updatesLookup,
      requestedDois:clone(raw.usage.requestedDois),
      updateRequestedDois:clone(raw.usage.updateRequestedDois??(raw.usage.updatesLookup==='REQUESTED'?raw.usage.requestedDois:[])),
      missingUpdates:clone(raw.usage.missingUpdates??[]),
      issues:array(raw.warnings).map(value=>value.code)});
    for(let index=0;index<raw.results.length;index++){
      const result=raw.results[index],work=result.metadata?.crossref,noticeDoi=doi(work?.DOI);
      if(!noticeDoi)continue;
      const grouped=new Map();
      for(const relation of array(work['update-to'])){
        const targetDoi=doi(relation?.DOI);
        if(!targetDoi||typeof relation.type!=='string'||!relation.type.trim()){
          observed.issues.push('CROSSREF_UPDATE_RELATION_INVALID');continue;
        }
        const type=relation.type,noticeId='cu_'+citationDigest({noticeDoi,targetDoi,type});
        if(!grouped.has(noticeId))grouped.set(noticeId,{noticeId,targetDoi,type,relations:[]});
        grouped.get(noticeId).relations.push(relation);
      }
      for(const {noticeId,targetDoi,type,relations} of grouped.values()){
        // Publisher and Retraction Watch may both register this same notice.
        // Keep every distinct assertion; array order and duplicate rows do not
        // create a second impact or spuriously reopen a completed review.
        const registeredUpdates=registeredAssertions(relations),registeredUpdate=registeredUpdates[0];
        const recordSha256=citationDigest(work);
        const noticeVersion=citationDigest(meaningfulRecord(work,registeredUpdates));
        let notice=notices.get(noticeId);
        if(!notice){
          notice={noticeId,noticeDoi,targetDoi,type,noticeSources:[],versions:[]};
          notices.set(noticeId,notice);
        }
        const sourceOccurrenceId='o_'+digest(Buffer.from(edition.id+'\n'+index));
        const captures=documentEdition?[]:array(result.metadata.sourceOccurrences).map(item=>({
          captureSha256:item.captureSha256,sourceUrl:item.sourceUrl,retrievedAt:item.retrievedAt,
          role:item.role,requestedDois:clone(item.requestedDois)}));
        const documents=documentEdition?array(result.metadata.sourceDocuments).map(clone):[];
        const source={editionId:edition.id,editionLabel:edition.label,questionId:edition.questionId,
          sourceKind:documentEdition?'retained-document':'http-capture',
          occurrenceId:sourceOccurrenceId,key:String(index),sourceSha256:edition.raw.sha256,
          sourceBytes:edition.raw.bytes,recordSha256,noticeVersion,registeredUpdate,registeredUpdates,captures,documents};
        notice.noticeSources.push(source);
        if(!notice.versions.some(value=>value.noticeVersion===noticeVersion))
          notice.versions.push({noticeVersion,title:result.title,registeredUpdate,registeredUpdates,
            sourceSha256:edition.raw.sha256});
        // Dossier edition order selects the latest received observation. Prior
        // observations, including an absent relationship in a later response, remain retained.
        Object.assign(notice,{title:result.title,date:dateLabel(registeredUpdate.updated),
          label:registeredUpdate.label??type,noticeVersion,registeredUpdate,registeredUpdates,latestSource:source});
      }
    }
  }
  const citationOptions=[...occurrences.values()].map(value=>fields(value,
    ['occurrenceId','questionId','editionId','key','title','doi','retained']));
  const reviews=state.citationReviews??[];
  for(const notice of notices.values()){
    notice.evidence=[...occurrences.values()].filter(value=>value.doi===notice.targetDoi);
    const affected=new Set(notice.evidence.map(value=>value.occurrenceId));
    notice.findings=state.findings.filter(value=>value.occurrenceIds.some(id=>affected.has(id))).map(value=>({
      ...findingSnapshot(value),affectedOccurrenceIds:value.occurrenceIds.filter(id=>affected.has(id))}));
    const used=new Set(notice.findings.flatMap(value=>value.occurrenceIds));
    notice.evidence=notice.evidence.map(value=>({...value,usedByFinding:used.has(value.occurrenceId)}));
    notice.questionIds=[...new Set([...notice.evidence.map(value=>value.questionId),
      ...notice.findings.map(value=>value.questionId)])];
    notice.selectedEvidenceCount=notice.evidence.filter(value=>value.selected).length;
    notice.findingCount=notice.findings.length;
    notice.fingerprint=citationDigest({noticeId:notice.noticeId,noticeVersion:notice.noticeVersion,
      evidence:notice.evidence.filter(value=>value.selected||value.usedByFinding).map(value=>defined({
        occurrenceId:value.occurrenceId,editionId:value.editionId,questionId:value.questionId,
        title:value.title,selected:value.selected,classification:value.classification,note:value.note})),
      findings:notice.findings.map(value=>fields(value,['id','questionId','title','text','occurrenceIds']))});
    notice.reviews=reviews.filter(value=>value.noticeId===notice.noticeId).map(clone);
    const last=notice.reviews.at(-1);
    notice.lastReview=brief(last);
    notice.status=last?.afterFingerprint===notice.fingerprint?
      (last.decision==='follow-up'?'FOLLOW_UP':'REVIEWED'):last?'REVIEW_AGAIN':'PENDING';
    const questions=new Set(notice.findings.map(value=>value.questionId));
    notice.citationOptions=citationOptions.filter(value=>questions.has(value.questionId));
  }
  return {notices:[...notices.values()],coverage,occurrences};
}

export function citationUpdatePage(state,model,{noticeId,offset=0,limit=30,status='all'}={}){
  need(['all','pending','reviewed'].includes(status),'CITATION_REVIEW_FILTER_INVALID');
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
    'CITATION_REVIEW_PAGE_INVALID');
  const dossier={id:state.id,title:state.title,revision:state.revision};
  const counts={total:model.notices.length,pending:model.notices.filter(value=>['PENDING','REVIEW_AGAIN'].includes(value.status)).length,
    reviewed:model.notices.filter(value=>value.status==='REVIEWED').length,
    followUp:model.notices.filter(value=>value.status==='FOLLOW_UP').length};
  const base={schema:CITATION_REVIEW_SCHEMA,dossier,counts,coverage:clone(model.coverage)};
  if(noticeId!==undefined){
    const detail=model.notices.find(value=>value.noticeId===noticeId);need(detail,'CITATION_NOTICE_NOT_FOUND');
    return {...base,detail:clone(detail)};
  }
  const values=model.notices.filter(value=>status==='all'||(status==='reviewed'?value.status==='REVIEWED':value.status!=='REVIEWED'));
  need(offset<=values.length,'CITATION_REVIEW_PAGE_INVALID');
  const items=values.slice(offset,offset+limit).map(value=>({...fields(value,
    ['noticeId','noticeDoi','targetDoi','title','type','label','date','status','fingerprint',
      'selectedEvidenceCount','findingCount','questionIds','lastReview']),observationCount:value.noticeSources.length}));
  const nextOffset=offset+items.length<values.length?offset+items.length:null;
  return {...base,items,offset,limit,total:values.length,nextOffset};
}

export function citationReviewInput(input){
  need(object(input)&&Object.keys(input).every(key=>['requestId','noticeId','expectedFingerprint','expectedRevision',
    'actor','decision','reason','evidenceChanges','findingChanges','findingDispositions'].includes(key)),
    'CITATION_REVIEW_FIELDS_INVALID');
  need(typeof input.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId),'CITATION_REVIEW_REQUEST_REQUIRED');
  need(typeof input.noticeId==='string'&&/^cu_[a-f0-9]{64}$/.test(input.noticeId),'CITATION_NOTICE_INVALID');
  need(hash(input.expectedFingerprint),'CITATION_REVIEW_FINGERPRINT_REQUIRED');
  need(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=1,'EXPECTED_REVISION_REQUIRED');
  need(CITATION_DECISIONS.includes(input.decision),'CITATION_REVIEW_DECISION_INVALID');
  const value={requestId:input.requestId,noticeId:input.noticeId,expectedFingerprint:input.expectedFingerprint,
    expectedRevision:input.expectedRevision,actor:text(input.actor,'CITATION_REVIEW_ACTOR_REQUIRED',200),
    decision:input.decision,reason:text(input.reason,'CITATION_REVIEW_REASON_REQUIRED',20000),
    evidenceChanges:[],findingChanges:[],findingDispositions:[]};
  for(const name of ['evidenceChanges','findingChanges','findingDispositions'])
    need(input[name]===undefined||Array.isArray(input[name])&&input[name].length<=10000,'CITATION_REVIEW_CHANGES_INVALID');
  value.evidenceChanges=array(input.evidenceChanges).map(item=>{
    need(object(item)&&Object.keys(item).every(key=>['occurrenceId','selected','classification','note'].includes(key))&&
      occurrence(item.occurrenceId)&&typeof item.selected==='boolean'&&
      ['supports','contradicts','background','unreviewed'].includes(item.classification),'CITATION_EVIDENCE_CHANGE_INVALID');
    return {occurrenceId:item.occurrenceId,selected:item.selected,classification:item.classification,
      note:text(item.note??'','CITATION_EVIDENCE_NOTE_INVALID',100000,true)};
  });
  value.findingChanges=array(input.findingChanges).map(item=>{
    need(object(item)&&Object.keys(item).every(key=>['id','title','text','occurrenceIds'].includes(key))&&finding(item.id)&&
      Array.isArray(item.occurrenceIds)&&item.occurrenceIds.every(occurrence)&&
      new Set(item.occurrenceIds).size===item.occurrenceIds.length,'CITATION_FINDING_CHANGE_INVALID');
    return {id:item.id,title:text(item.title,'FINDING_TITLE_REQUIRED',240),
      text:text(item.text,'FINDING_TEXT_REQUIRED',100000),occurrenceIds:[...item.occurrenceIds]};
  });
  value.findingDispositions=array(input.findingDispositions).map(item=>{
    need(object(item)&&Object.keys(item).every(key=>['findingId','disposition','reason'].includes(key))&&
      finding(item.findingId)&&FINDING_DISPOSITIONS.includes(item.disposition),'CITATION_FINDING_DISPOSITION_INVALID');
    return {findingId:item.findingId,disposition:item.disposition,
      reason:text(item.reason,'CITATION_FINDING_REASON_REQUIRED',20000)};
  });
  for(const [name,key]of [['evidenceChanges','occurrenceId'],['findingChanges','id'],['findingDispositions','findingId']])
    need(new Set(value[name].map(item=>item[key])).size===value[name].length,'CITATION_REVIEW_DUPLICATE_CHANGE');
  return value;
}

/** Apply exactly the operator's source/finding edits to one original state clone. */
export function applyCitationReview(state,model,input,createdAt){
  const notice=model.notices.find(value=>value.noticeId===input.noticeId);need(notice,'CITATION_NOTICE_NOT_FOUND');
  need(notice.fingerprint===input.expectedFingerprint,'CITATION_REVIEW_CHANGED');
  const evidence=new Map(notice.evidence.map(value=>[value.occurrenceId,value]));
  const affectedFindings=new Map(notice.findings.map(value=>[value.id,value]));
  need(input.findingDispositions.length===affectedFindings.size&&
    input.findingDispositions.every(value=>affectedFindings.has(value.findingId)),'CITATION_FINDING_DISPOSITION_REQUIRED');
  const changes={evidence:[],findings:[]};
  for(const change of input.evidenceChanges){
    const source=evidence.get(change.occurrenceId);need(source,'CITATION_EVIDENCE_OUTSIDE_NOTICE');
    let saved=state.selections.find(value=>value.occurrenceId===change.occurrenceId);
    const before=saved?selectionSnapshot(saved):null;
    const old={selected:saved?.selected??false,classification:saved?.classification??'unreviewed',note:saved?.note??''};
    if(same(old,fields(change,['selected','classification','note'])))continue;
    if(!saved){
      saved=fields(source,['occurrenceId','editionId','questionId','key']);
      state.selections.push(saved);
    }
    Object.assign(saved,change,{updatedAt:createdAt});
    changes.evidence.push({occurrenceId:change.occurrenceId,before,after:selectionSnapshot(saved)});
  }
  for(const change of input.findingChanges){
    need(affectedFindings.has(change.id),'CITATION_FINDING_OUTSIDE_NOTICE');
    const saved=state.findings.find(value=>value.id===change.id),before=findingSnapshot(saved);
    for(const key of change.occurrenceIds){
      const citation=model.occurrences.get(key);
      need(citation?.questionId===saved.questionId||(!citation&&saved.occurrenceIds.includes(key)),
        'FINDING_SOURCE_QUESTION_MISMATCH');
    }
    if(same(fields(saved,['id','title','text','occurrenceIds']),change))continue;
    Object.assign(saved,change,{updatedAt:createdAt});
    changes.findings.push({findingId:change.id,before,after:findingSnapshot(saved)});
  }
  for(const disposition of input.findingDispositions){
    const updated=state.findings.find(value=>value.id===disposition.findingId);
    const changed=changes.findings.some(value=>value.findingId===disposition.findingId);
    if(disposition.disposition==='unchanged')need(!changed,'CITATION_FINDING_DISPOSITION_MISMATCH');
    if(disposition.disposition==='revised')need(changed,'CITATION_FINDING_DISPOSITION_MISMATCH');
    if(disposition.disposition==='citation-removed')need(changed&&updated.occurrenceIds.every(id=>!evidence.has(id)),
      'CITATION_FINDING_DISPOSITION_MISMATCH');
  }
  return {notice,changes};
}

/** Record the complete review by applying its request once to the actual previous state. */
export function recordCitationReview(state,projected,input,createdAt){
  const request=citationReviewInput(input);
  need(state.revision===request.expectedRevision,'REVISION_CONFLICT');
  need(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt)),'CITATION_REVIEW_TIME_INVALID');
  need(!(state.citationReviews??[]).some(value=>value.requestId===request.requestId),
    'CITATION_REVIEW_REQUEST_ALREADY_RECORDED');
  const originalRevisionSha256=digest(jsonBytes(state));
  const model=citationUpdateModel(state,projected),applied=applyCitationReview(state,model,request,createdAt);
  const after=citationUpdateModel(state,projected).notices.find(value=>value.noticeId===request.noticeId);
  const payload={schema:CITATION_REVIEW_SCHEMA,
    id:'cur_'+citationDigest({dossierId:state.id,requestId:request.requestId}),dossierId:state.id,
    requestId:request.requestId,requestSha256:citationDigest(request),request:clone(request),noticeId:request.noticeId,
    actor:request.actor,decision:request.decision,reason:request.reason,createdAt,
    originalRevision:state.revision,originalRevisionSha256,revision:state.revision+1,
    beforeFingerprint:applied.notice.fingerprint,afterFingerprint:after.fingerprint,
    notice:citationNoticeSnapshot(applied.notice),changes:applied.changes,
    findingDispositions:clone(request.findingDispositions)};
  const review={...payload,sha256:citationDigest(payload)};
  state.citationReviews=[...(state.citationReviews??[]),review];
  return review;
}

/** Immutable review entries travel with every original JSON/streamed portable revision. */
export function validateCitationReviewState(state,editions){
  need(state.citationReviews===undefined||Array.isArray(state.citationReviews),'PORTABLE_CITATION_REVIEWS_INVALID');
  const ids=new Set(),requests=new Set();
  for(const review of state.citationReviews??[]){
    need(object(review)&&review.schema===CITATION_REVIEW_SCHEMA&&
      review.id==='cur_'+citationDigest({dossierId:state.id,requestId:review.requestId})&&
      review.dossierId===state.id&&Number.isSafeInteger(review.originalRevision)&&review.originalRevision>=1&&
      review.revision===review.originalRevision+1&&review.revision<=state.revision&&
      hash(review.originalRevisionSha256)&&hash(review.beforeFingerprint)&&hash(review.afterFingerprint)&&
      typeof review.createdAt==='string'&&Number.isFinite(Date.parse(review.createdAt)),
      'PORTABLE_CITATION_REVIEW_INVALID');
    need(!ids.has(review.id)&&!requests.has(review.requestId),'PORTABLE_CITATION_REVIEW_DUPLICATE');
    ids.add(review.id);requests.add(review.requestId);
    const request=citationReviewInput(review.request);
    need(same(request,review.request)&&citationDigest(request)===review.requestSha256&&
      review.requestId===request.requestId&&review.noticeId===request.noticeId&&
      review.originalRevision===request.expectedRevision&&review.beforeFingerprint===request.expectedFingerprint&&
      review.actor===request.actor&&review.reason===request.reason&&review.decision===request.decision,
      'PORTABLE_CITATION_REQUEST_CHANGED');
    const {sha256,...payload}=review;need(sha256===citationDigest(payload),'PORTABLE_CITATION_REVIEW_CHANGED');
    const source=review.notice?.latestSource,edition=editions.get(source?.editionId);
    need(edition?.mode==='retained'&&edition.raw.sha256===source.sourceSha256&&edition.raw.bytes===source.sourceBytes&&
      occurrence(source.occurrenceId)&&source.occurrenceId==='o_'+digest(Buffer.from(edition.id+'\n'+source.key))&&
      review.notice.noticeId===review.noticeId&&hash(review.notice.noticeVersion)&&
      ['http-capture','retained-document'].includes(source.sourceKind)&&
      Array.isArray(source.captures)&&source.captures.every(value=>hash(value.captureSha256)&&
        typeof value.sourceUrl==='string'&&value.sourceUrl.startsWith('https://api.crossref.org/'))&&
      Array.isArray(source.documents)&&source.documents.every(value=>
        typeof value.documentId==='string'&&value.documentId.length>0&&hash(value.documentSha256)&&
        hash(value.bodySha256)&&Number.isSafeInteger(value.bodyBytes)&&value.bodyBytes>0&&
        typeof value.sourceUrl==='string'&&value.sourceUrl.startsWith('https://api.crossref.org/'))&&
      (source.sourceKind==='retained-document'?source.documents.length>0&&source.captures.length===0:
        source.captures.length>0&&source.documents.length===0),
      'PORTABLE_CITATION_NOTICE_BINDING_INVALID');
    need(object(review.changes)&&Array.isArray(review.changes.evidence)&&Array.isArray(review.changes.findings)&&
      Array.isArray(review.findingDispositions)&&same(review.findingDispositions,request.findingDispositions),
      'PORTABLE_CITATION_CHANGES_INVALID');
  }
}
export function validateCitationReviewTransition(previous,state,projected){
  const old=previous?.citationReviews??[],current=state.citationReviews??[];
  need(current.length>=old.length&&old.every((value,index)=>same(value,current[index])),
    'PORTABLE_CITATION_HISTORY_CHANGED');
  const added=current.slice(old.length);
  need(added.length<=1&&added.every(value=>value.revision===state.revision&&
    value.originalRevision===previous?.revision&&value.originalRevisionSha256===state.previous),
    'PORTABLE_CITATION_HISTORY_INVALID');
  if(!added.length)return;
  need(previous&&projected instanceof Map,'PORTABLE_CITATION_SOURCE_REQUIRED');
  need(state.revision===previous.revision+1&&state.previous===digest(jsonBytes(previous)),
    'PORTABLE_CITATION_HISTORY_INVALID');
  // Reuse the exact operation that saved the review. This binds the notice and
  // every assertion/capture/occurrence to the original retained edition, and
  // verifies the saved text, citations and evidence changes against its request.
  const expected=clone(previous),review=added[0];
  const replayed=recordCitationReview(expected,projected,review.request,review.createdAt);
  need(same(replayed,review),'PORTABLE_CITATION_REPLAY_CHANGED');
  Object.assign(expected,{revision:state.revision,previous:state.previous,
    updatedAt:state.updatedAt,change:state.change});
  need(same(expected,state),'PORTABLE_CITATION_STATE_CHANGED');
}
