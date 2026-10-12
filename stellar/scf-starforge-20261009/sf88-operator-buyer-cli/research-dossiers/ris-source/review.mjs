// MIT. Explicit interpretation and duplicate review over complete original RIS bytes.
import {jsonBytes,parseJson,need} from '../../node/store.mjs';
import {RIS_SOURCE_SCHEMA,RIS_EDITION_SCHEMA,RIS_PREVIEW_SCHEMA,RIS_PARSER_VERSION,RIS_LIMITS,
  clone,sha,exact,text,time,integer,canonical,valueSha,equal,descriptor,decodeBase64,
  inspectRisSource,originalRecordBytes} from './schema.mjs';

const classifications=['supports','contradicts','background','unreviewed'];
const question=value=>{need(/^q_[a-f0-9-]{36}$/.test(value),'RIS_QUESTION_INVALID');return value;};
const requestId=value=>text(value,'RIS_REQUEST_ID_REQUIRED',240);
const values=(record,tags)=>record.tags.filter(row=>tags.includes(row.tag));
const meaningful=value=>String(value).trim();
function doi(value){
  let result=meaningful(value).replace(/^doi:\s*/i,'');
  try{
    const candidate=new URL(result);
    if(['http:','https:'].includes(candidate.protocol)&&/^(?:dx\.)?doi\.org$/i.test(candidate.hostname)&&
      !candidate.username&&!candidate.password&&!candidate.search&&!candidate.hash)
      result=decodeURIComponent(candidate.pathname.slice(1));
  }catch{}
  return /^10\.\d{4,9}\/[^\s<>"\u0000-\u001f]+$/i.test(result)?result.toLowerCase():null;
}
function nativeUrl(value){
  try{const parsed=new URL(meaningful(value));
    return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?meaningful(value):null;
  }catch{return null;}
}
export function risCandidates(record){
  const title=values(record,['TI','T1','CT']).map(row=>({tagIndex:row.index,tag:row.tag,value:row.value,
    normalized:meaningful(row.value)})).filter(row=>row.normalized);
  const titleOrder={TI:0,T1:1,CT:2};title.sort((a,b)=>titleOrder[a.tag]-titleOrder[b.tag]||a.tagIndex-b.tagIndex);
  const dois=values(record,['DO']).map(row=>({tagIndex:row.index,tag:row.tag,value:row.value,
    normalized:doi(row.value)})).filter(row=>row.normalized);
  const years=values(record,['PY','Y1','DA']).map(row=>({tagIndex:row.index,tag:row.tag,value:row.value,
    normalized:/^\s*(\d{4})(?:\D|$)/.exec(row.value)?.[1]??null})).filter(row=>row.normalized);
  return {title,doi:dois,year:years};
}
function defaultTag(candidates){
  return new Set(candidates.map(row=>row.normalized)).size===1?candidates[0]?.tagIndex??null:null;
}
function selectedCandidate(candidates,index,field){
  need(index===null||Number.isSafeInteger(index),'RIS_'+field+'_CHOICE_INVALID');
  if(index===null)return null;
  const selected=candidates.find(row=>row.tagIndex===index);
  need(selected,'RIS_'+field+'_CHOICE_CHANGED');return selected;
}
function recordChoice(record,input={}){
  exact(input,['recordId','selected','classification','note','titleTagIndex','doiTagIndex','yearTagIndex',
    'interpretationReviewed','interpretationReason'],'RIS_RECORD_CHOICE_INVALID');
  need(input.recordId===undefined||input.recordId===record.id,'RIS_RECORD_CHOICE_CHANGED');
  const candidates=risCandidates(record),ambiguities=Object.entries(candidates)
    .filter(([,items])=>new Set(items.map(row=>row.normalized)).size>1).map(([field])=>field);
  const choice={recordId:record.id,selected:input.selected??record.complete,
    classification:input.classification??'unreviewed',note:input.note??'',
    titleTagIndex:input.titleTagIndex===undefined?defaultTag(candidates.title):input.titleTagIndex,
    doiTagIndex:input.doiTagIndex===undefined?defaultTag(candidates.doi):input.doiTagIndex,
    yearTagIndex:input.yearTagIndex===undefined?defaultTag(candidates.year):input.yearTagIndex,
    interpretationReviewed:input.interpretationReviewed??false,interpretationReason:input.interpretationReason??''};
  need(typeof choice.selected==='boolean'&&typeof choice.interpretationReviewed==='boolean','RIS_RECORD_CHOICE_INVALID');
  need(classifications.includes(choice.classification),'RIS_CLASSIFICATION_INVALID');
  text(choice.note,'RIS_NOTE_INVALID',100000,{empty:true});
  text(choice.interpretationReason,'RIS_INTERPRETATION_REASON_INVALID',10000,{empty:true});
  const selected={title:selectedCandidate(candidates.title,choice.titleTagIndex,'TITLE'),
    doi:selectedCandidate(candidates.doi,choice.doiTagIndex,'DOI'),
    year:selectedCandidate(candidates.year,choice.yearTagIndex,'YEAR')};
  const chosenDoi=selected.doi?.normalized??'';
  const authors=values(record,['AU','A1']).map(row=>row.value);
  const abstracts=values(record,['AB','N2']).map(row=>row.value);
  const metadata={title:selected.title?.normalized??'Untitled RIS record',
    doi:chosenDoi,year:selected.year?.normalized??'',authors,abstracts,
    type:meaningful(values(record,['TY'])[0]?.value??''),
    journal:values(record,['JF','JO','T2']).map(row=>row.value),
    urls:values(record,['UR','L1','L2','LK']).map(row=>nativeUrl(row.value)).filter(Boolean),
    nativeIds:values(record,['ID','AN']).map(row=>({tag:row.tag,value:row.value})),
    identityKey:chosenDoi?'doi:'+chosenDoi:'ris-record:'+record.id.slice('risrec_'.length)};
  const issues=[];
  if(choice.selected&&!record.complete)issues.push({code:'MALFORMED_RECORD_SELECTED',recordId:record.id});
  if(choice.selected&&ambiguities.length&&(!choice.interpretationReviewed||!choice.interpretationReason.trim()))
    issues.push({code:'NATIVE_FIELD_REVIEW_REQUIRED',recordId:record.id,fields:ambiguities});
  return {choice,metadata,candidates,ambiguities,issues};
}
function duplicateGroups(rows){
  const grouped=new Map();
  for(const row of rows){
    let basis,key;
    if(row.metadata.doi){basis='native-doi';key=row.metadata.identityKey;}
    else if(row.metadata.title!=='Untitled RIS record'){
      basis='exact-title-year-authors';
      key=valueSha({title:row.metadata.title.normalize('NFC').toLocaleLowerCase('en-US'),
        year:row.metadata.year,authors:row.metadata.authors.map(value=>meaningful(value).normalize('NFC').toLocaleLowerCase('en-US'))});
    }else continue;
    const identity=basis+':'+key;
    if(!grouped.has(identity))grouped.set(identity,{basis,key,recordIds:[]});
    grouped.get(identity).recordIds.push(row.record.id);
  }
  return [...grouped.values()].filter(group=>group.recordIds.length>1).map(group=>({
    ...group,id:'risdup_'+valueSha(group),automaticMerge:group.basis==='native-doi',
    note:group.basis==='native-doi'?'The original Research source view groups this explicit DOI; each occurrence remains separate.':
      'Matching displayed metadata is a review candidate only; these records retain separate source identities.'}));
}
function previous(value){
  if(value===undefined||value===null)return null;
  exact(value,['editionId','sha256','priorSelection'],'RIS_PREVIOUS_EDITION_INVALID');
  need(/^e_[a-f0-9]{64}$/.test(value.editionId)&&/^[a-f0-9]{64}$/.test(value.sha256),'RIS_PREVIOUS_EDITION_INVALID');
  need(['keep','deselect'].includes(value.priorSelection),'RIS_PRIOR_SELECTION_INVALID');return clone(value);
}
export function prepareRisReview(prepared,input,{complete=false}={}){
  exact(input,['requestId','questionId','actor','reviewedAt','records','duplicates','acknowledgedDiagnostics','previous'],
    'RIS_REVIEW_INPUT_INVALID');
  const recordInputs=input.records??[];
  need(Array.isArray(recordInputs)&&recordInputs.length<=RIS_LIMITS.records,'RIS_RECORD_CHOICES_INVALID');
  const choiceMap=new Map();
  for(const row of recordInputs){
    need(typeof row?.recordId==='string'&&!choiceMap.has(row.recordId),'RIS_RECORD_CHOICE_DUPLICATE');
    choiceMap.set(row.recordId,row);
  }
  const rows=prepared.analysis.records.map(record=>({record,...recordChoice(record,choiceMap.get(record.id))}));
  need([...choiceMap.keys()].every(id=>rows.some(row=>row.record.id===id)),'RIS_RECORD_CHOICE_UNKNOWN');
  if(complete)need(recordInputs.length===rows.length,'RIS_ALL_RECORD_CHOICES_REQUIRED');
  const groups=duplicateGroups(rows),groupInputs=input.duplicates??[],groupMap=new Map();
  need(Array.isArray(groupInputs)&&groupInputs.length<=groups.length,'RIS_DUPLICATE_REVIEWS_INVALID');
  for(const row of groupInputs){
    exact(row,['groupId','decision','reason'],'RIS_DUPLICATE_REVIEW_INVALID');
    need(groups.some(group=>group.id===row.groupId)&&!groupMap.has(row.groupId),'RIS_DUPLICATE_GROUP_CHANGED');
    need(['','keep-all','choose','defer'].includes(row.decision),'RIS_DUPLICATE_DECISION_INVALID');
    text(row.reason,'RIS_DUPLICATE_REASON_REQUIRED',10000,{empty:true});groupMap.set(row.groupId,clone(row));
  }
  const issues=rows.flatMap(row=>row.issues),byId=new Map(rows.map(row=>[row.record.id,row]));
  for(const group of groups){
    const reviewed=groupMap.get(group.id),selected=group.recordIds.filter(id=>byId.get(id).choice.selected);
    group.selectedRecordIds=selected;group.review=reviewed??null;
    if(!reviewed||!reviewed.decision||!reviewed.reason.trim())
      issues.push({code:'DUPLICATE_REVIEW_REQUIRED',groupId:group.id,recordIds:group.recordIds});
    else if(reviewed.decision==='keep-all'&&selected.length!==group.recordIds.length||
      reviewed.decision==='choose'&&(selected.length===0||selected.length===group.recordIds.length)||
      reviewed.decision==='defer'&&selected.length!==0)
      issues.push({code:'DUPLICATE_SELECTION_CHANGED',groupId:group.id,recordIds:group.recordIds});
  }
  const acknowledged=input.acknowledgedDiagnostics??[];
  need(Array.isArray(acknowledged)&&new Set(acknowledged).size===acknowledged.length&&
    acknowledged.every(id=>prepared.analysis.diagnostics.some(issue=>issue.id===id)),'RIS_DIAGNOSTIC_ACKNOWLEDGMENT_INVALID');
  const requiredDiagnostics=prepared.analysis.diagnostics.filter(issue=>issue.severity==='error');
  for(const diagnostic of requiredDiagnostics)if(!acknowledged.includes(diagnostic.id))
    issues.push({code:'SOURCE_DIAGNOSTIC_REVIEW_REQUIRED',diagnosticId:diagnostic.id,documentId:diagnostic.documentId});
  const review={requestId:requestId(input.requestId),questionId:question(input.questionId),
    actor:text(input.actor,'RIS_REVIEWER_REQUIRED',500),reviewedAt:time(input.reviewedAt,'RIS_REVIEW_TIME_REQUIRED'),
    records:rows.map(row=>row.choice),duplicates:groups.filter(group=>group.review).map(group=>clone(group.review)),
    acknowledgedDiagnostics:[...acknowledged].sort(),previous:previous(input.previous)};
  if(complete)need(issues.length===0,'RIS_REVIEW_INCOMPLETE');
  const plan={schema:RIS_PREVIEW_SCHEMA,parser:RIS_PARSER_VERSION,source:clone(prepared.descriptor),review};
  return {schema:RIS_PREVIEW_SCHEMA,source:clone(prepared.descriptor),review,
    planSha256:valueSha(plan),complete:issues.length===0,issues,groups,rows,
    diagnostics:clone(prepared.analysis.diagnostics),documents:clone(prepared.analysis.documents),
    counts:{...prepared.analysis.counts,selected:rows.filter(row=>row.choice.selected).length,
      duplicateGroups:groups.length,unresolvedIssues:issues.length}};
}
export function createRisEdition(prepared,input,{expectedPlanSha256}={}){
  const reviewed=prepareRisReview(prepared,input,{complete:true});
  need(expectedPlanSha256===reviewed.planSha256,'RIS_REVIEW_PLAN_CHANGED');
  const edition={schema:RIS_EDITION_SCHEMA,provider:'ris-document',parser:RIS_PARSER_VERSION,
    source:{...prepared.descriptor,bodyBase64:prepared.bytes.toString('base64')},
    review:reviewed.review,planSha256:reviewed.planSha256};
  const bytes=jsonBytes(edition);need(bytes.length<=RIS_LIMITS.editionBytes,'RIS_EDITION_TOO_LARGE');
  return {edition,bytes,descriptor:{bytes:bytes.length,sha256:sha(bytes)},prepared,reviewed};
}
export function inspectRisEdition(input){
  const rawBytes=Buffer.isBuffer(input)?input:typeof input==='string'?Buffer.from(input,'utf8'):jsonBytes(input);
  need(rawBytes.length<=RIS_LIMITS.editionBytes,'RIS_EDITION_TOO_LARGE');
  const edition=parseJson(rawBytes);
  exact(edition,['schema','provider','parser','source','review','planSha256'],'RIS_EDITION_INVALID');
  need(edition.schema===RIS_EDITION_SCHEMA&&edition.provider==='ris-document'&&edition.parser===RIS_PARSER_VERSION,
    'RIS_EDITION_SCHEMA_INVALID');
  exact(edition.source,['bytes','sha256','bodyBase64'],'RIS_EDITION_SOURCE_INVALID');
  const sourceBytes=decodeBase64(edition.source.bodyBase64,{maximum:RIS_LIMITS.sourceBytes,name:'RIS_EDITION_SOURCE_INVALID'});
  need(sourceBytes.length===edition.source.bytes&&sha(sourceBytes)===edition.source.sha256,'RIS_EDITION_SOURCE_CHANGED');
  const prepared=inspectRisSource(sourceBytes);
  const checked=createRisEdition(prepared,edition.review,{expectedPlanSha256:edition.planSha256});
  need(equal(checked.edition,edition),'RIS_EDITION_CHANGED');
  return {...checked,bytes:rawBytes,descriptor:{bytes:rawBytes.length,sha256:sha(rawBytes)}};
}
export function projectRisEdition(input){
  const inspected=inspectRisEdition(input),{prepared,reviewed}=inspected;
  return {schema:'sf88-research-results-v1',provider:'ris-document',
    query:prepared.source.documents.map(document=>document.declaration.database+': '+document.declaration.query).join('\n'),
    status:prepared.analysis.diagnostics.some(issue=>issue.severity==='error')?'PARTIAL':'AVAILABLE',
    sourceTerms:prepared.source.sourceTerms,
    usage:{sourceKind:'original-ris-documents',parser:RIS_PARSER_VERSION,source:prepared.descriptor,
      documents:prepared.analysis.documents.map(document=>({id:document.id,filename:document.filename,
        bytes:document.bytes,sha256:document.sha256,encoding:document.encoding,declaration:document.declaration})),
      records:reviewed.counts.records,selected:reviewed.counts.selected,planSha256:reviewed.planSha256},
    warnings:reviewed.diagnostics.map(issue=>({code:issue.code,severity:issue.severity,documentId:issue.documentId,
      line:issue.line,acknowledged:reviewed.review.acknowledgedDiagnostics.includes(issue.id)})),
    results:reviewed.rows.map(({record,choice,metadata,candidates,ambiguities})=>({
      id:record.id,title:metadata.title,doi:metadata.doi,url:metadata.urls[0]??'',publishedAt:metadata.year,
      authors:metadata.authors,content:{abstracts:metadata.abstracts,nativeFields:record.tags.map(field=>({tag:field.tag,value:field.value}))},
      citation:{type:metadata.type,journal:metadata.journal,year:metadata.year,nativeIds:metadata.nativeIds},
      metadata:{ris:{recordId:record.id,documentId:record.documentId,filename:record.documentFilename,
        ordinal:record.ordinal,start:record.start,end:record.end,bytes:record.bytes,sha256:record.sha256,
        encoding:record.encoding,database:record.database,query:record.query,identityKey:metadata.identityKey,
        sourceKind:'original-ris-file',complete:record.complete,sourceTerms:record.sourceTerms,
        choice,candidates,ambiguities,fields:record.tags,diagnostics:record.diagnostics}}
    }))};
}
export function risPreviewPage(reviewed,{offset=0,limit=50,recordId}={}){
  integer(offset,'RIS_OFFSET_INVALID',0,RIS_LIMITS.records);integer(limit,'RIS_LIMIT_INVALID',1,100);
  const publicRow=({record,choice,metadata,candidates,ambiguities,issues},detail=false)=>({
    recordId:record.id,documentId:record.documentId,filename:record.documentFilename,ordinal:record.ordinal,
    bytes:record.bytes,sha256:record.sha256,start:record.start,end:record.end,encoding:record.encoding,
    complete:record.complete,database:record.database,query:record.query,metadata:clone(metadata),choice:clone(choice),
    candidates:clone(candidates),ambiguities:[...ambiguities],issues:clone(issues),
    ...(detail?{fields:clone(record.tags),rawText:record.rawText,diagnostics:clone(record.diagnostics)}:{})
  });
  if(recordId!==undefined){
    const row=reviewed.rows.find(row=>row.record.id===recordId);need(row,'RIS_RECORD_NOT_FOUND');
    return {schema:RIS_PREVIEW_SCHEMA,source:reviewed.source,planSha256:reviewed.planSha256,
      complete:reviewed.complete,counts:reviewed.counts,record:publicRow(row,true)};
  }
  return {schema:RIS_PREVIEW_SCHEMA,source:reviewed.source,planSha256:reviewed.planSha256,
    complete:reviewed.complete,counts:clone(reviewed.counts),documents:clone(reviewed.documents),
    diagnostics:clone(reviewed.diagnostics),issues:clone(reviewed.issues),groups:clone(reviewed.groups),
    review:clone(reviewed.review),offset,limit,
    records:reviewed.rows.slice(offset,offset+limit).map(row=>publicRow(row)),
    nextOffset:offset+limit<reviewed.rows.length?offset+limit:null};
}
export function selectedRisBytes(inspected){
  const selected=inspected.reviewed.rows.filter(row=>row.choice.selected);
  const chunks=[];
  for(const {record} of selected){
    need(record.complete,'RIS_MALFORMED_EXPORT_RECORD');
    // Exact original record text is transcoded only for this explicitly derived UTF-8 export.
    const text=record.rawText;chunks.push(Buffer.from(text.endsWith('\n')||text.endsWith('\r')?text:text+'\n','utf8'));
  }
  return Buffer.concat(chunks);
}
export function risRecordFile(inspected,recordId){
  const record=inspected.prepared.analysis.records.find(row=>row.id===recordId);need(record,'RIS_RECORD_NOT_FOUND');
  return {record,bytes:originalRecordBytes(inspected.prepared.source,record)};
}
export function compareRisEditions(before,after){
  const summarize=inspected=>inspected.reviewed.rows.map(row=>({recordId:row.record.id,documentId:row.record.documentId,
    identity:row.metadata.identityKey,title:row.metadata.title,doi:row.metadata.doi,sha256:row.record.sha256,
    selected:row.choice.selected,choice:clone(row.choice),metadata:clone(row.metadata),
    fields:row.record.tags.map(field=>({tag:field.tag,value:field.value})),
    declaration:clone(inspected.prepared.source.documents.find(document=>document.id===row.record.documentId).declaration)}));
  const left=summarize(before),right=summarize(after),groups=rows=>{
    const map=new Map();for(const row of rows){if(!map.has(row.identity))map.set(row.identity,[]);map.get(row.identity).push(row);}return map;
  },a=groups(left),b=groups(right),added=[],absent=[],changed=[],unchanged=[];
  const choice=row=>{const {recordId,...rest}=row.choice;return rest;};
  const ordered=(rows,select)=>rows.map(select).sort((x,y)=>canonical(x).localeCompare(canonical(y)));
  const fields=row=>row.fields,selection=row=>row.selected,declaration=row=>row.declaration;
  const projection=row=>row.metadata;
  const complete=row=>({fields:fields(row),choice:choice(row),metadata:projection(row),declaration:declaration(row)});
  for(const [identity,records]of b){
    const prior=a.get(identity);
    if(!prior){added.push({identity,records});continue;}
    if(equal(ordered(prior,complete),ordered(records,complete)))unchanged.push({identity,before:prior,after:records});
    else changed.push({identity,before:prior,after:records,
      changes:{nativeFields:!equal(ordered(prior,fields),ordered(records,fields)),
        selection:!equal(ordered(prior,selection),ordered(records,selection)),
        review:!equal(ordered(prior,choice),ordered(records,choice)),
        interpretation:!equal(ordered(prior,projection),ordered(records,projection)),
        sourceDeclaration:!equal(ordered(prior,declaration),ordered(records,declaration)),
        occurrences:prior.length!==records.length}});
  }
  for(const[identity,records]of a)if(!b.has(identity))absent.push({identity,records});
  return {schema:'sf88-research-ris-comparison-v1',before:before.descriptor,after:after.descriptor,
    interpretation:'Absence is a source-edition difference; it does not establish a publication retraction.',
    counts:{added:added.length,absent:absent.length,changed:changed.length,unchanged:unchanged.length},
    added,absent,changed,unchanged};
}
