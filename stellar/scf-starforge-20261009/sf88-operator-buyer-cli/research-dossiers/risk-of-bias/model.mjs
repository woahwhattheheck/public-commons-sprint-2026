// MIT. Risk appraisal events share the original dossier, registry and revision writer.
import {digest,jsonBytes,need,object} from '../../node/store.mjs';
import {eligibilityModel} from '../eligibility-review.mjs';
import {sourceBundleFileBytes,SOURCE_BUNDLE_SCHEMA} from '../source-bundles.mjs';
import {extractionSourcePointers,extractionTypedValue} from '../study-extraction.mjs';
import {
  RISK_OF_BIAS_SCHEMA,RISK_OF_BIAS_OPERATION_SCHEMA,RISK_OF_BIAS_SECTIONS,
  clone,array,hash,occurrence,text,fields,identifier,ids,occurrenceIds,nullableId,
  riskOfBiasInput,riskOfBiasDigest,riskOfBiasProtocol,riskOfBiasTarget,riskOfBiasContent,
  passageInput,same,byId,entityId,latestBy,
} from './contracts.mjs';

const compareText=(left,right)=>left<right?-1:left>right?1:0;
const actorKey=value=>[value.assessmentEditionId,value.actor.id].join('\n');
const currentProtocol=(model,reviewId)=>model.protocols.filter(value=>value.reviewId===reviewId).at(-1)??null;
const currentAssessment=(model,id)=>model.assessmentHistory.filter(value=>value.id===id).at(-1)??null;
const currentActor=(rows,assessment,actor)=>rows.filter(value=>
  value.assessmentEditionId===assessment.editionId&&value.actor.id===actor.id).at(-1)??null;
const registeredActor=(protocol,actor,allowed=protocol.definition.reviewers.map(value=>value.id))=>{
  need(protocol.definition.reviewers.some(value=>value.id===actor.id&&value.name===actor.name)&&allowed.includes(actor.id),
    'RISK_OF_BIAS_ACTOR_OUTSIDE_PROCESS');
};
const serial=value=>JSON.parse(JSON.stringify(value));
const rawPassage=value=>Object.fromEntries(['occurrenceId','fileName','locator','quote','jsonPointer','note']
  .filter(key=>value[key]!==undefined).map(key=>[key,clone(value[key])]));
const rawContent=value=>({
  answers:value.answers.map(answer=>({...clone(answer),basis:answer.basis.map(rawPassage)})),
  judgments:value.judgments.map(judgment=>({...clone(judgment),basis:judgment.basis.map(rawPassage)})),
  overall:value.overall?{...clone(value.overall),basis:value.overall.basis.map(rawPassage)}:null,
});
function records(state){
  const model={reviews:[],protocols:[],assessmentHistory:[],drafts:[],submissions:[],adjudications:[],
    impactReviews:[],operations:array(state.riskOfBiasEvents)};
  for(const operation of model.operations){
    const result=operation.result;
    for(const [key,collection] of [['review','reviews'],['protocol','protocols'],['assessment','assessmentHistory'],
      ['draft','drafts'],['submission','submissions'],['adjudication','adjudications'],['impactReview','impactReviews']])
      if(result[key])model[collection].push(result[key]);
  }
  model.assessments=latestBy(model.assessmentHistory,value=>value.id);
  return model;
}
function registryModel(state,projected,registry){
  const eligibility=eligibilityModel(state,projected);
  const studyHistory=eligibility.studyHistory.map(record=>({
    studyId:record.id,studyVersion:record.version,studySha256:riskOfBiasDigest(record),
    name:record.name,questionId:record.questionId,occurrenceIds:clone(record.occurrenceIds),record:clone(record),
  }));
  const studies=latestBy(studyHistory,value=>value.studyId),currentStudies=new Map(studies.map(value=>[value.studyId,value]));
  for(const row of studyHistory)row.current=currentStudies.get(row.studyId)?.studySha256===row.studySha256;
  need(registry&&object(registry),'RISK_OF_BIAS_REGISTRY_INVALID');
  need(registry.results===undefined||Array.isArray(registry.results),'RISK_OF_BIAS_RESULTS_REGISTRY_INVALID');
  const resultHistory=[],seen=new Map();
  for(const row of registry.results??[]){
    need(object(row)&&object(row.record)&&Number.isSafeInteger(row.version)&&row.version>=1,
      'RISK_OF_BIAS_RESULT_REGISTRY_RECORD_INVALID');
    const result={resultId:identifier(row.id),resultVersion:row.version,resultSha256:riskOfBiasDigest(row.record),
      studyId:identifier(row.studyId),questionId:identifier(row.questionId),
      occurrenceIds:occurrenceIds(row.occurrenceIds,'RISK_OF_BIAS_RESULT_REGISTRY_SOURCES_INVALID'),
      name:text(row.name??row.id,'RISK_OF_BIAS_RESULT_REGISTRY_NAME_INVALID',1000),record:clone(row.record),
      ...(row.editionId===undefined?{}:{editionId:identifier(row.editionId)}),
      ...(row.current===undefined?{}:{current:row.current}),
      ...(row.status===undefined?{}:{status:text(row.status,'RISK_OF_BIAS_RESULT_REGISTRY_STATUS_INVALID',200,true)})};
    need(row.current===undefined||typeof row.current==='boolean','RISK_OF_BIAS_RESULT_REGISTRY_CURRENT_INVALID');
    const key=result.resultId+'\n'+result.resultVersion;
    if(seen.has(key)){need(same(seen.get(key),result),'RISK_OF_BIAS_RESULT_REGISTRY_VERSION_CHANGED');continue;}
    seen.set(key,result);resultHistory.push(result);
  }
  const resultIds=new Set(resultHistory.map(value=>value.resultId)),results=[];
  for(const id of resultIds){
    const rows=resultHistory.filter(value=>value.resultId===id);
    const explicit=rows.some(value=>Object.hasOwn(value,'current'));
    const selected=explicit?rows.filter(value=>value.current):[rows.reduce((a,b)=>a.resultVersion>b.resultVersion?a:b)];
    need(selected.length<=1,'RISK_OF_BIAS_RESULT_REGISTRY_CURRENT_AMBIGUOUS');
    if(selected.length)results.push(selected[0]);
    if(!explicit)for(const row of rows)row.current=row===selected[0];
  }
  return {eligibility,studyHistory,studies:studies.map(value=>({...value,current:true})),
    resultHistory,results,resultsAvailable:Array.isArray(registry.results),occurrences:eligibility.occurrences};
}
function sourceRows(state,projected,index){
  const rows=new Map();
  for(const source of index.values()){
    const projection=projected.get(source.editionId),row=projection?.items?.find(value=>String(value.key)===String(source.key));
    if(row)rows.set(source.occurrenceId,{source,row,projection});
  }
  return rows;
}
function selectedSource(model,id,questionId,allowed){
  const selected=model.sourceRows.get(id);
  need(selected&&selected.source.questionId===questionId&&allowed.includes(id),'RISK_OF_BIAS_SOURCE_OUTSIDE_TARGET');
  return selected;
}
const escapePointer=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');
function plainLeaves(value){
  const leaves=[],pending=[{value,pointer:''}];let visited=0;
  while(pending.length){
    need(++visited<=1000000,'RISK_OF_BIAS_SOURCE_TOO_COMPLEX');
    const next=pending.pop();
    if(typeof next.value==='string')leaves.push(next);
    else if(Array.isArray(next.value))for(let i=next.value.length-1;i>=0;i--)
      pending.push({value:next.value[i],pointer:next.pointer+'/'+i});
    else if(object(next.value))for(const key of Object.keys(next.value).sort().reverse())
      pending.push({value:next.value[key],pointer:next.pointer+'/'+escapePointer(key)});
  }
  return leaves;
}
function plainPointer(value,pointer){
  if(pointer==='')return {found:true,value};
  for(const part of pointer.slice(1).split('/').map(value=>value.replaceAll('~1','/').replaceAll('~0','~'))){
    if(Array.isArray(value)){
      if(!/^(?:0|[1-9]\d*)$/.test(part)||Number(part)>=value.length)return {found:false};
      value=value[Number(part)];
    }else if(object(value)&&Object.hasOwn(value,part))value=value[part];
    else return {found:false};
  }
  return {found:true,value};
}
function typedLeaves(root){
  const leaves=[],pending=[{value:root,pointer:''}];
  while(pending.length){
    const next=pending.pop(),[tag,value]=next.value;
    if(tag==='str')leaves.push({value,pointer:next.pointer});
    else if(tag==='array')for(let i=value.length-1;i>=0;i--)pending.push({value:value[i],pointer:next.pointer+'/'+i});
    else if(tag==='object')for(const [key,item] of [...value].sort((a,b)=>compareText(a[0],b[0])).reverse())
      pending.push({value:item,pointer:next.pointer+'/'+escapePointer(key)});
  }
  return leaves;
}
function typedPointer(root,pointer){
  let value=root;
  if(pointer==='')return {found:true,typedValue:value};
  for(const part of pointer.slice(1).split('/').map(value=>value.replaceAll('~1','/').replaceAll('~0','~'))){
    if(value[0]==='object'){
      const entry=value[1].find(([key])=>key===part);if(!entry)return {found:false};value=entry[1];
    }else if(value[0]==='array'){
      if(!/^(?:0|[1-9]\d*)$/.test(part)||Number(part)>=value[1].length)return {found:false};value=value[1][Number(part)];
    }else return {found:false};
  }
  return {found:true,typedValue:value};
}
function originalFile(selected,fileName){
  need(selected.projection.raw?.schema===SOURCE_BUNDLE_SCHEMA,'RISK_OF_BIAS_SOURCE_BUNDLE_REQUIRED');
  const file=selected.row.content?.files?.find(value=>value.name===fileName);
  need(file,'RISK_OF_BIAS_SOURCE_FILE_NOT_FOUND');
  const bytes=sourceBundleFileBytes(file);
  return {bytes,file:{name:file.name,sha256:file.sha256,bytes:file.bytes,mediaType:file.mediaType??null}};
}
function literalMatch(value,quote,pointer){
  const start=value.indexOf(quote);need(start>=0,'RISK_OF_BIAS_QUOTE_NOT_IN_SOURCE');
  return {mode:'literal',jsonPointer:pointer,start,end:start+quote.length,units:'utf16-code-units',
    utf8Start:Buffer.byteLength(value.slice(0,start),'utf8'),
    utf8End:Buffer.byteLength(value.slice(0,start+quote.length),'utf8'),textSha256:digest(Buffer.from(value,'utf8'))};
}
async function preparePassages(state,projected,model,questionId,allowed,inputs,options){
  const cache=new Map(),resolved=new Map();
  for(const input of inputs){
    const value=passageInput(input),key=riskOfBiasDigest(value);
    if(resolved.has(key))continue;
    const selected=selectedSource(model,value.occurrenceId,questionId,allowed);
    let file=null,bytes=null,tree=selected.row.original,parser=null,typed=null;
    if(value.fileName!==undefined){
      const original=originalFile(selected,value.fileName);file=original.file;bytes=original.bytes;
      if(value.quote||value.jsonPointer){
        const isJson=/\.json$/i.test(file.name)||/^(?:application|text)\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(file.mediaType??'');
        if(isJson||value.jsonPointer){
          const fileKey=value.occurrenceId+'\n'+value.fileName;
          if(!cache.has(fileKey)){
            const reply=await extractionSourcePointers(state,projected,{occurrenceId:value.occurrenceId,pointers:[''],
              fileName:value.fileName},options);
            const root=reply.values?.[0];
            need(reply.dossierId===state.id&&reply.revision===state.revision&&root?.found===true&&root.pointer===''&&
              root.contentSha256===file.sha256&&root.contentBytes===file.bytes&&root.file?.name===file.name&&
              root.file.sha256===file.sha256,'RISK_OF_BIAS_ORIGINAL_SOURCE_RESOLVER_CHANGED');
            extractionTypedValue(root.typedValue);
            cache.set(fileKey,root);
          }
          const root=cache.get(fileKey);typed=root.typedValue;parser=clone(root.parser);
        }else tree=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      }
    }
    let match={mode:'locator-only'},pointer=value.jsonPointer;
    if(value.quote){
      let leaf;
      if(pointer){
        const found=typed?typedPointer(typed,pointer):plainPointer(tree,pointer);
        need(found.found,'RISK_OF_BIAS_PASSAGE_POINTER_NOT_FOUND');
        leaf=typed?(found.typedValue[0]==='str'?found.typedValue[1]:null):found.value;
        need(typeof leaf==='string','RISK_OF_BIAS_PASSAGE_POINTER_NOT_TEXT');
      }else{
        const candidate=(typed?typedLeaves(typed):plainLeaves(tree)).find(value=>value.value.includes(input.quote));
        need(candidate,'RISK_OF_BIAS_QUOTE_NOT_IN_SOURCE');leaf=candidate.value;pointer=candidate.pointer;
      }
      match=literalMatch(leaf,value.quote,pointer);
    }else if(pointer){
      const found=typed?typedPointer(typed,pointer):plainPointer(tree,pointer);
      need(found.found,'RISK_OF_BIAS_PASSAGE_POINTER_NOT_FOUND');
      match={mode:'json-pointer',jsonPointer:pointer,valueSha256:riskOfBiasDigest(typed?found.typedValue:found.value),
        ...(typed?{typedValue:clone(found.typedValue)}:{})};
    }
    resolved.set(key,{...value,source:clone(selected.source),...(file?{file}:{}),
      ...(bytes?{contentSha256:digest(bytes),contentBytes:bytes.length}:{}),...(parser?{parser}:{}),match});
  }
  return input=>{
    const value=resolved.get(riskOfBiasDigest(passageInput(input)));
    need(value,'RISK_OF_BIAS_PREPARED_PASSAGE_MISSING');return clone(value);
  };
}
function comparisonFor(model,assessment){
  const protocol=byId(model.protocols,assessment.protocolId,'RISK_OF_BIAS_PROTOCOL_NOT_FOUND');
  const submissions=latestBy(model.submissions.filter(value=>value.assessmentEditionId===assessment.editionId),
    value=>value.actor.id).sort((a,b)=>compareText(a.actor.id,b.actor.id));
  const rows=[],form=protocol.definition.form;
  function row(kind,label,fieldId=null,domainId=null){
    const values=submissions.map(submission=>({submissionId:submission.id,actor:clone(submission.actor),
      answer:kind==='field'?clone(submission.answers.find(answer=>answer.fieldId===fieldId)??null):null,
      judgment:kind==='domain'?clone(submission.judgments.find(value=>value.domainId===domainId)??null):
        kind==='overall'?clone(submission.overall):null}));
    const substantive=values.map(value=>value.answer?{status:value.answer.status,value:value.answer.value}:
      value.judgment?{judgmentId:value.judgment.judgmentId,basisStatus:value.judgment.basisStatus}:null);
    const rationale=values.map(value=>value.answer?{rationale:value.answer.rationale,basis:value.answer.basis}:
      value.judgment?{rationale:value.judgment.rationale,basis:value.judgment.basis}:null);
    const different=values=>new Set(values.map(riskOfBiasDigest)).size>1;
    rows.push({key:kind+':'+(fieldId??domainId??'overall'),kind,fieldId,domainId,label,values,
      valueDisagreement:different(substantive),rationaleVariation:different(rationale)});
  }
  for(const domain of form.domains){
    for(const field of domain.fields)row('field',field.label,field.id,domain.id);
    row('domain',domain.title,null,domain.id);
  }
  row('overall','Overall judgment');
  const complete=submissions.length>=protocol.definition.minimumReviewers;
  const valueDisagreement=rows.some(row=>row.valueDisagreement),rationaleVariation=rows.some(row=>row.rationaleVariation);
  const core={assessmentId:assessment.id,assessmentEditionId:assessment.editionId,reviewId:assessment.reviewId,
    protocolId:protocol.id,protocolSha256:riskOfBiasDigest(protocol),
    submissionIds:submissions.map(value=>value.id),submissionSha256:submissions.map(riskOfBiasDigest)};
  const sha256=riskOfBiasDigest(core);
  const adjudication=model.adjudications.filter(value=>value.assessmentEditionId===assessment.editionId).at(-1)??null;
  const adjudicationCurrent=!!adjudication&&adjudication.comparisonSha256===sha256&&same(adjudication.submissionIds,core.submissionIds);
  return {...core,assessmentName:assessment.name,sha256,rows,complete,valueDisagreement,rationaleVariation,
    expectedReviewers:clone(protocol.definition.reviewers),completedReviewers:submissions.map(value=>clone(value.actor)),
    minimumReviewers:protocol.definition.minimumReviewers,adjudication:clone(adjudication),adjudicationCurrent,
    status:adjudicationCurrent?'adjudicated':!complete?'awaiting_reviews':valueDisagreement?'disagreement':'agreement'};
}
function impactsFor(state,model){
  const impacts=[];
  function add(kind,title,reviewId,assessment,before,after){
    const identity={kind,reviewId,assessmentId:assessment?.id??null,assessmentEditionId:assessment?.editionId??null};
    const fingerprint=riskOfBiasDigest({...identity,before,after});
    const id='ri_'+riskOfBiasDigest({...identity,fingerprint});
    const lastReview=model.impactReviews.filter(value=>value.impactId===id&&value.fingerprint===fingerprint).at(-1)??null;
    impacts.push({id,fingerprint,...identity,title,before:clone(before),after:clone(after),lastReview:clone(lastReview),
      status:lastReview?.disposition??'needs_review'});
  }
  for(const review of model.reviews){
    const protocol=currentProtocol(model,review.id),question=state.questions.find(value=>value.id===review.questionId);
    if(protocol&&(!question||question.text!==protocol.question.text))
      add('question_changed','The review question changed',review.id,null,protocol.question,question?{id:question.id,text:question.text}:null);
  }
  for(const assessment of model.assessments){
    const review=byId(model.reviews,assessment.reviewId,'RISK_OF_BIAS_REVIEW_NOT_FOUND');
    const current=currentProtocol(model,review.id),protocol=byId(model.protocols,assessment.protocolId,'RISK_OF_BIAS_PROTOCOL_NOT_FOUND');
    if(current.id!==protocol.id)add('protocol_changed','A newer protocol or form edition is available',review.id,assessment,
      {protocolId:protocol.id,sha256:riskOfBiasDigest(protocol)},{protocolId:current.id,sha256:riskOfBiasDigest(current)});
    const study=model.studies.find(value=>value.studyId===assessment.target.studyId);
    if(!study||study.studySha256!==assessment.target.studySha256)
      add('study_changed','The original study linkage changed',review.id,assessment,
        {studyId:assessment.target.studyId,version:assessment.target.studyVersion,sha256:assessment.target.studySha256},
        study?{studyId:study.studyId,version:study.studyVersion,sha256:study.studySha256}:null);
    if(assessment.target.scope==='result'){
      const result=model.results.find(value=>value.resultId===assessment.target.resultId);
      if(!model.resultsAvailable)add('result_registry_unavailable','The original result registry is not attached',review.id,assessment,
        {resultId:assessment.target.resultId,version:assessment.target.resultVersion,sha256:assessment.target.resultSha256},null);
      else if(!result||result.resultSha256!==assessment.target.resultSha256)
        add('result_changed','The selected result has a different current edition',review.id,assessment,
          {resultId:assessment.target.resultId,version:assessment.target.resultVersion,sha256:assessment.target.resultSha256},
          result?{resultId:result.resultId,version:result.resultVersion,sha256:result.resultSha256,editionId:result.editionId??null}:null);
    }
    for(const source of assessment.target.sources){
      const retained=model.occurrences.get(source.occurrenceId);
      if(!retained||!same(retained,source))add('retained_source_changed','The original source binding changed',review.id,assessment,source,retained??null);
      const latest=[...model.occurrences.values()].filter(value=>value.questionId===source.questionId&&
        value.sourceId===source.sourceId).at(-1);
      if(latest&&latest.occurrenceId!==source.occurrenceId)
        add('source_edition_added','A newer occurrence of this source is retained',review.id,assessment,
          {occurrenceId:source.occurrenceId,editionId:source.editionId,sourceSha256:source.sourceSha256,contentDigest:source.contentDigest},
          {occurrenceId:latest.occurrenceId,editionId:latest.editionId,sourceSha256:latest.sourceSha256,contentDigest:latest.contentDigest});
    }
    const comparison=model.comparisons.find(value=>value.assessmentEditionId===assessment.editionId);
    if(comparison?.adjudication&&!comparison.adjudicationCurrent)
      add('submission_corrected','A later reviewer correction changes the adjudication basis',review.id,assessment,
        {adjudicationId:comparison.adjudication.id,comparisonSha256:comparison.adjudication.comparisonSha256,
          submissionIds:comparison.adjudication.submissionIds},
        {comparisonSha256:comparison.sha256,submissionIds:comparison.submissionIds});
  }
  return latestBy(impacts,value=>value.id);
}
export function riskOfBiasModel(state,projected,registry={}){
  need(projected instanceof Map,'RISK_OF_BIAS_RETAINED_PROJECTIONS_REQUIRED');
  const model={...records(state),...registryModel(state,projected,registry)};
  model.sourceRows=sourceRows(state,projected,model.occurrences);
  model.comparisons=model.assessmentHistory.map(assessment=>comparisonFor(model,assessment));
  model.impact=impactsFor(state,model);
  return model;
}
function protocolEdition(state,model,review,definition,request,createdAt,reason){
  const previous=currentProtocol(model,review.id),question=byId(state.questions,review.questionId,'QUESTION_NOT_FOUND');
  return {id:entityId('rp',state,request),reviewId:review.id,edition:(previous?.edition??0)+1,
    question:{id:question.id,text:question.text},definition:riskOfBiasProtocol(definition),
    supersedes:previous?.id??null,reason,createdAt,actor:clone(request.actor),
    originalRevision:state.revision,revision:state.revision+1};
}
function assessmentContext(model,reviewId,data,{latest=false}={}){
  identifier(data.assessmentId);identifier(data.assessmentEditionId);
  const assessment=model.assessmentHistory.find(value=>value.id===data.assessmentId&&value.editionId===data.assessmentEditionId);
  need(assessment&&assessment.reviewId===reviewId,'RISK_OF_BIAS_ASSESSMENT_NOT_FOUND');
  if(latest)need(currentAssessment(model,assessment.id)?.editionId===assessment.editionId,'RISK_OF_BIAS_ASSESSMENT_EDITION_CHANGED');
  const protocol=byId(model.protocols,assessment.protocolId,'RISK_OF_BIAS_PROTOCOL_NOT_FOUND');
  return {assessment,protocol};
}
async function boundTarget(state,projected,model,review,protocol,value,options){
  const target=riskOfBiasTarget(value);
  need(protocol.definition.instrument.applicableDesigns.includes(target.design),'RISK_OF_BIAS_INSTRUMENT_DESIGN_MISMATCH');
  need(protocol.definition.instrument.scope===target.scope,'RISK_OF_BIAS_INSTRUMENT_SCOPE_MISMATCH');
  const study=model.studyHistory.find(row=>row.studyId===target.studyId&&row.studyVersion===target.studyVersion);
  need(study&&study.studySha256===target.studySha256&&study.questionId===review.questionId&&
    study.record.reviewId===review.eligibilityReviewId,'RISK_OF_BIAS_STUDY_BINDING_CHANGED');
  let result=null;
  if(target.scope==='result'){
    need(model.resultsAvailable,'RISK_OF_BIAS_ORIGINAL_RESULT_REGISTRY_REQUIRED');
    result=model.resultHistory.find(row=>row.resultId===target.resultId&&row.resultVersion===target.resultVersion);
    need(result&&result.resultSha256===target.resultSha256&&result.questionId===review.questionId&&result.studyId===study.studyId,
      'RISK_OF_BIAS_RESULT_BINDING_CHANGED');
    need(result.occurrenceIds.every(id=>target.occurrenceIds.includes(id)),'RISK_OF_BIAS_RESULT_SOURCES_MISSING');
  }
  const linked=new Set([...study.occurrenceIds,...(result?.occurrenceIds??[])]);
  need(target.occurrenceIds.every(id=>linked.has(id)),'RISK_OF_BIAS_TARGET_REPORT_NOT_LINKED');
  const sources=target.occurrenceIds.map(id=>clone(selectedSource(model,id,review.questionId,target.occurrenceIds).source));
  const bind=await preparePassages(state,projected,model,review.questionId,target.occurrenceIds,target.designBasis,options);
  const frozen=value=>value?Object.fromEntries(Object.entries(clone(value)).filter(([key])=>key!=='current')):null;
  return {...target,designBasis:target.designBasis.map(bind),study:frozen(study),result:frozen(result),sources};
}
const passagesIn=data=>[...data.answers.flatMap(value=>value.basis),...data.judgments.flatMap(value=>value.basis),
  ...(data.overall?.basis??[])];
async function reviewContent(state,projected,model,review,assessment,protocol,data,complete,options){
  // Structural validation precedes source resolution; no partial record can be stored.
  const raw=riskOfBiasContent(data,protocol,{complete});
  const bind=await preparePassages(state,projected,model,review.questionId,assessment.target.occurrenceIds,passagesIn(raw),options);
  return riskOfBiasContent(raw,protocol,{complete,bind});
}
async function applyAction(state,projected,model,request,createdAt,options){
  const data=request.data,actor=clone(request.actor),common={createdAt,actor,originalRevision:state.revision,revision:state.revision+1};
  if(request.action==='create-review'){
    fields(data,['questionId','eligibilityReviewId','name','description','protocol'],'RISK_OF_BIAS_CREATE_FIELDS_INVALID');
    const question=byId(state.questions,data.questionId,'QUESTION_NOT_FOUND');
    const eligibility=byId(model.eligibility.reviews,data.eligibilityReviewId,'RISK_OF_BIAS_ELIGIBILITY_REVIEW_NOT_FOUND');
    need(eligibility.questionId===question.id,'RISK_OF_BIAS_ELIGIBILITY_QUESTION_MISMATCH');
    const review={id:entityId('rr',state,request),questionId:question.id,eligibilityReviewId:eligibility.id,
      name:text(data.name,'RISK_OF_BIAS_REVIEW_NAME_REQUIRED',1000),
      description:text(data.description??'','RISK_OF_BIAS_REVIEW_DESCRIPTION_INVALID',20000,true),...common};
    return {review,protocol:protocolEdition(state,model,review,data.protocol,request,createdAt,'Initial protocol')};
  }
  const review=byId(model.reviews,request.reviewId,'RISK_OF_BIAS_REVIEW_NOT_FOUND');
  if(request.action==='revise-protocol'){
    fields(data,['protocol','reason'],'RISK_OF_BIAS_PROTOCOL_CHANGE_FIELDS_INVALID');
    const reason=text(data.reason,'RISK_OF_BIAS_PROTOCOL_CHANGE_REASON_REQUIRED');
    const protocol=protocolEdition(state,model,review,data.protocol,request,createdAt,reason);
    const previous=currentProtocol(model,review.id);
    need(!same(protocol.definition,previous.definition)||!same(protocol.question,previous.question),'RISK_OF_BIAS_PROTOCOL_UNCHANGED');
    return {protocol};
  }
  if(['create-assessment','revise-assessment'].includes(request.action)){
    const revising=request.action==='revise-assessment';
    fields(data,revising?['assessmentId','assessmentEditionId','name','protocolId','target','reason']:
      ['name','protocolId','target','reason'],'RISK_OF_BIAS_ASSESSMENT_FIELDS_INVALID');
    const previous=revising?assessmentContext(model,review.id,data,{latest:true}).assessment:null;
    const protocol=byId(model.protocols,data.protocolId,'RISK_OF_BIAS_PROTOCOL_NOT_FOUND');
    need(protocol.reviewId===review.id,'RISK_OF_BIAS_PROTOCOL_REVIEW_MISMATCH');
    const name=text(data.name,'RISK_OF_BIAS_ASSESSMENT_NAME_REQUIRED',1000),reason=text(data.reason,'RISK_OF_BIAS_ASSESSMENT_REASON_REQUIRED');
    const target=await boundTarget(state,projected,model,review,protocol,data.target,options);
    if(previous)need(name!==previous.name||protocol.id!==previous.protocolId||!same(target,previous.target),
      'RISK_OF_BIAS_ASSESSMENT_UNCHANGED');
    return {assessment:{id:previous?.id??entityId('ra',state,request),editionId:entityId('rae',state,request),
      version:(previous?.version??0)+1,reviewId:review.id,questionId:review.questionId,name,protocolId:protocol.id,
      protocolSha256:riskOfBiasDigest(protocol),target,supersedes:previous?.editionId??null,reason,...common}};
  }
  if(request.action==='save-draft'){
    fields(data,['assessmentId','assessmentEditionId','answers','judgments','overall','supersedes','reason'],
      'RISK_OF_BIAS_DRAFT_FIELDS_INVALID');
    const {assessment,protocol}=assessmentContext(model,review.id,data);
    registeredActor(protocol,actor);
    const previous=currentActor(model.drafts,assessment,actor);
    need(nullableId(data.supersedes,'RISK_OF_BIAS_DRAFT_SUPERSEDES_INVALID')===(previous?.id??null),
      'RISK_OF_BIAS_DRAFT_CHANGED');
    const reason=text(data.reason??'','RISK_OF_BIAS_DRAFT_REASON_REQUIRED',20000,!previous);
    const content=await reviewContent(state,projected,model,review,assessment,protocol,data,false,options);
    return {draft:{id:entityId('rd',state,request),reviewId:review.id,assessmentId:assessment.id,
      assessmentEditionId:assessment.editionId,protocolId:protocol.id,supersedes:previous?.id??null,reason,...content,...common}};
  }
  if(request.action==='submit-review'){
    fields(data,['assessmentId','assessmentEditionId','draftId','supersedes','reason'],'RISK_OF_BIAS_SUBMISSION_FIELDS_INVALID');
    const {assessment,protocol}=assessmentContext(model,review.id,data);registeredActor(protocol,actor);
    const draft=currentActor(model.drafts,assessment,actor);
    need(draft?.id===data.draftId,'RISK_OF_BIAS_CURRENT_ACTOR_DRAFT_REQUIRED');
    const previous=currentActor(model.submissions,assessment,actor);
    need(nullableId(data.supersedes,'RISK_OF_BIAS_SUBMISSION_SUPERSEDES_INVALID')===(previous?.id??null),
      'RISK_OF_BIAS_SUBMISSION_CHANGED');
    need(!previous||previous.draftId!==draft.id,'RISK_OF_BIAS_DRAFT_ALREADY_SUBMITTED');
    const content=await reviewContent(state,projected,model,review,assessment,protocol,rawContent(draft),true,options);
    need(same(content,{answers:draft.answers,judgments:draft.judgments,overall:draft.overall}),
      'RISK_OF_BIAS_DRAFT_SOURCE_BINDING_CHANGED');
    return {submission:{id:entityId('rs',state,request),reviewId:review.id,assessmentId:assessment.id,
      assessmentEditionId:assessment.editionId,protocolId:protocol.id,draftId:draft.id,draftSha256:riskOfBiasDigest(draft),
      supersedes:previous?.id??null,reason:text(data.reason,'RISK_OF_BIAS_SUBMISSION_REASON_REQUIRED'),...content,...common}};
  }
  if(request.action==='adjudicate'){
    fields(data,['assessmentId','assessmentEditionId','submissionIds','expectedComparisonSha256','answers','judgments',
      'overall','supersedes','reason'],'RISK_OF_BIAS_ADJUDICATION_FIELDS_INVALID');
    const {assessment,protocol}=assessmentContext(model,review.id,data);registeredActor(protocol,actor,protocol.definition.resolverIds);
    const comparison=byId(model.comparisons.map(value=>({...value,id:value.assessmentEditionId})),
      assessment.editionId,'RISK_OF_BIAS_COMPARISON_NOT_FOUND');
    const selected=ids(data.submissionIds,'RISK_OF_BIAS_SUBMISSIONS_REQUIRED');
    need(hash(data.expectedComparisonSha256)&&data.expectedComparisonSha256===comparison.sha256&&
      same(selected,comparison.submissionIds),'RISK_OF_BIAS_COMPARISON_CHANGED');
    need(comparison.complete,'RISK_OF_BIAS_INDEPENDENT_REVIEWS_REQUIRED');
    need(nullableId(data.supersedes,'RISK_OF_BIAS_ADJUDICATION_SUPERSEDES_INVALID')===(comparison.adjudication?.id??null),
      'RISK_OF_BIAS_ADJUDICATION_CHANGED');
    const content=await reviewContent(state,projected,model,review,assessment,protocol,data,true,options);
    return {adjudication:{id:entityId('rj',state,request),reviewId:review.id,assessmentId:assessment.id,
      assessmentEditionId:assessment.editionId,protocolId:protocol.id,submissionIds:selected,
      comparisonSha256:comparison.sha256,supersedes:comparison.adjudication?.id??null,
      reason:text(data.reason,'RISK_OF_BIAS_ADJUDICATION_REASON_REQUIRED'),...content,...common}};
  }
  if(request.action==='review-impact'){
    fields(data,['impactId','fingerprint','disposition','reason'],'RISK_OF_BIAS_IMPACT_FIELDS_INVALID');
    const impact=byId(model.impact,data.impactId,'RISK_OF_BIAS_IMPACT_NOT_FOUND');
    need(impact.reviewId===review.id&&impact.fingerprint===data.fingerprint,'RISK_OF_BIAS_IMPACT_CHANGED');
    need(['reviewed','needs_review','out_of_scope'].includes(data.disposition),'RISK_OF_BIAS_IMPACT_DISPOSITION_INVALID');
    return {impactReview:{id:entityId('rir',state,request),reviewId:review.id,assessmentId:impact.assessmentId,
      assessmentEditionId:impact.assessmentEditionId,impactId:impact.id,fingerprint:impact.fingerprint,
      kind:impact.kind,before:clone(impact.before),after:clone(impact.after),disposition:data.disposition,
      reason:text(data.reason,'RISK_OF_BIAS_IMPACT_REASON_REQUIRED'),...common}};
  }
  need(false,'RISK_OF_BIAS_ACTION_INVALID');
}
export async function recordRiskOfBiasOperation(state,projected,input,createdAt,registry={},options={}){
  const request=riskOfBiasInput(input);
  const existing=array(state.riskOfBiasEvents).find(value=>value.requestId===request.requestId);
  if(existing){
    need(existing.requestSha256===riskOfBiasDigest(request),'RISK_OF_BIAS_REQUEST_CHANGED');
    return clone(existing);
  }
  need(state.revision===request.expectedRevision,'REVISION_CONFLICT');
  need(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt)),'RISK_OF_BIAS_TIME_INVALID');
  const originalRevisionSha256=digest(jsonBytes(state)),model=riskOfBiasModel(state,projected,registry);
  const result=await applyAction(state,projected,model,request,createdAt,options);
  const payload={schema:RISK_OF_BIAS_OPERATION_SCHEMA,id:entityId('ro',state,request),dossierId:state.id,
    requestId:request.requestId,requestSha256:riskOfBiasDigest(request),request:clone(request),
    reviewId:result.review?.id??request.reviewId,action:request.action,actor:clone(request.actor),createdAt,
    originalRevision:state.revision,revision:state.revision+1,originalRevisionSha256,result};
  const operation={...payload,sha256:riskOfBiasDigest(payload)};
  state.riskOfBiasEvents=[...array(state.riskOfBiasEvents),operation];return clone(operation);
}


export function selectRiskOfBias(state,model,options={}){
  let {reviewId,assessmentId,assessmentEditionId,actorId}=options;
  if(reviewId!==undefined&&reviewId!==null)identifier(reviewId);else reviewId=null;
  if(assessmentId!==undefined&&assessmentId!==null)identifier(assessmentId);else assessmentId=null;
  if(assessmentEditionId!==undefined&&assessmentEditionId!==null)identifier(assessmentEditionId);else assessmentEditionId=null;
  if(actorId!==undefined&&actorId!==null)identifier(actorId);else actorId=null;
  let assessment=null;
  if(assessmentEditionId){
    assessment=model.assessmentHistory.find(value=>value.editionId===assessmentEditionId&&(!assessmentId||value.id===assessmentId));
    need(assessment,'RISK_OF_BIAS_ASSESSMENT_NOT_FOUND');assessmentId=assessment.id;
  }else if(assessmentId){assessment=currentAssessment(model,assessmentId);need(assessment,'RISK_OF_BIAS_ASSESSMENT_NOT_FOUND');}
  if(assessment){
    need(!reviewId||reviewId===assessment.reviewId,'RISK_OF_BIAS_ASSESSMENT_REVIEW_MISMATCH');reviewId=assessment.reviewId;
  }
  const review=reviewId?byId(model.reviews,reviewId,'RISK_OF_BIAS_REVIEW_NOT_FOUND'):null;
  const reviews=model.reviews.filter(value=>!reviewId||value.id===reviewId),reviewIds=new Set(reviews.map(value=>value.id));
  const eligibilityIds=new Set(reviews.map(value=>value.eligibilityReviewId));
  const questionIds=new Set(reviews.map(value=>value.questionId));
  const historical=model.assessmentHistory.filter(value=>reviewIds.has(value.reviewId)&&
    (!assessmentId||value.id===assessmentId)&&(!assessmentEditionId||value.editionId===assessmentEditionId));
  const editionIds=new Set(historical.map(value=>value.editionId));
  const currentEditions=new Set(model.assessments.map(value=>value.editionId));
  const comparisons=model.comparisons.filter(value=>editionIds.has(value.assessmentEditionId));
  const comparisonMap=new Map(comparisons.map(value=>[value.assessmentEditionId,value]));
  const activeDrafts=new Set(latestBy(model.drafts,actorKey).map(value=>value.id));
  const activeSubmissions=new Set(latestBy(model.submissions,actorKey).map(value=>value.id));
  const activeAdjudications=new Set(latestBy(model.adjudications,value=>value.assessmentEditionId).map(value=>value.id));
  const assessmentName=value=>model.assessmentHistory.find(row=>row.editionId===value.assessmentEditionId)?.name??'';
  const drafts=model.drafts.filter(value=>editionIds.has(value.assessmentEditionId)&&(!actorId||value.actor.id===actorId))
    .map(value=>({...clone(value),current:activeDrafts.has(value.id),assessmentName:assessmentName(value)}));
  const submissions=model.submissions.filter(value=>editionIds.has(value.assessmentEditionId)&&(!actorId||value.actor.id===actorId))
    .map(value=>({...clone(value),current:activeSubmissions.has(value.id),assessmentName:assessmentName(value)}));
  const adjudications=model.adjudications.filter(value=>editionIds.has(value.assessmentEditionId)).map(value=>({
    ...clone(value),latest:activeAdjudications.has(value.id),assessmentName:assessmentName(value),
    current:comparisonMap.get(value.assessmentEditionId)?.adjudication?.id===value.id&&
      comparisonMap.get(value.assessmentEditionId)?.adjudicationCurrent===true,
  }));
  const studies=model.studyHistory.filter(value=>(!reviewId||eligibilityIds.has(value.record.reviewId))&&
    (!assessment||value.studyId===assessment.target.studyId));
  const studyIds=new Set(studies.map(value=>value.studyId));
  const results=model.resultHistory.filter(value=>(!reviewId||questionIds.has(value.questionId)&&studyIds.has(value.studyId))&&
    (!assessment||assessment.target.scope!=='result'||value.resultId===assessment.target.resultId));
  const sources=[...model.occurrences.values()].filter(value=>(!reviewId||questionIds.has(value.questionId))&&
    (!assessment||assessment.target.occurrenceIds.includes(value.occurrenceId))).map(value=>{
    const row=model.sourceRows.get(value.occurrenceId);
    return {...clone(value),files:array(row?.row?.content?.files).map(file=>({
      name:file.name,bytes:file.bytes,sha256:file.sha256,mediaType:file.mediaType??null,
    }))};
  });
  const impact=model.impact.filter(value=>reviewIds.has(value.reviewId)&&
    (!assessmentId||!value.assessmentId||value.assessmentId===assessmentId)&&
    (!assessmentEditionId||!value.assessmentEditionId||value.assessmentEditionId===assessmentEditionId));
  const protocol=assessment?byId(model.protocols,assessment.protocolId,'RISK_OF_BIAS_PROTOCOL_NOT_FOUND'):
    review?currentProtocol(model,review.id):null;
  const fullAssessment=value=>{
    const comparison=comparisonMap.get(value.editionId);
    return {...clone(value),current:currentEditions.has(value.editionId),status:comparison?.status??'awaiting_reviews',
      submittedReviewCount:comparison?.submissionIds.length??0,
      unresolvedImpactCount:impact.filter(row=>row.assessmentEditionId===value.editionId&&row.status==='needs_review').length};
  };
  const protocols=model.protocols.filter(value=>reviewIds.has(value.reviewId)).map(value=>({
    ...clone(value),current:currentProtocol(model,value.reviewId)?.id===value.id,
  }));
  const operations=model.operations.filter(value=>reviewIds.has(value.reviewId)&&(!assessmentId||
    value.result.assessment?.id===assessmentId||value.result.draft?.assessmentId===assessmentId||
    value.result.submission?.assessmentId===assessmentId||value.result.adjudication?.assessmentId===assessmentId||
    value.result.impactReview?.assessmentId===assessmentId||value.result.protocol||value.result.review));
  return {reviewId,assessmentId,assessmentEditionId:assessment?.editionId??null,actorId,
    review:clone(review),protocol:clone(protocol),assessment:assessment?fullAssessment(assessment):null,
    comparison:assessment?clone(model.comparisons.find(value=>value.assessmentEditionId===assessment.editionId)):null,
    actorDraft:assessment&&actorId?clone(currentActor(model.drafts,assessment,{id:actorId})):null,
    actorSubmission:assessment&&actorId?clone(currentActor(model.submissions,assessment,{id:actorId})):null,
    reviews:clone(reviews),protocols,assessments:historical.map(fullAssessment),drafts,submissions,
    comparisons:comparisons.map(value=>({...clone(value),current:currentEditions.has(value.assessmentEditionId)})),
    adjudications,impact:clone(impact),operations:clone(operations),studies:clone(studies),results:clone(results),sources,
  };
}
export function riskOfBiasOverview(model,selected){
  const selectedIds=new Set(selected.reviews.map(value=>value.id)),selectedEditions=new Set(selected.assessments.map(value=>value.editionId));
  const current=selected.assessments.filter(value=>value.current),currentIds=new Set(current.map(value=>value.editionId));
  const comparisons=selected.comparisons.filter(value=>currentIds.has(value.assessmentEditionId));
  const submissions=model.submissions.filter(value=>selectedIds.has(value.reviewId)&&selectedEditions.has(value.assessmentEditionId));
  return {
    reviewCount:selected.reviews.length,protocolEditionCount:selected.protocols.length,
    assessmentCount:new Set(selected.assessments.map(value=>value.id)).size,
    assessmentEditionCount:selected.assessments.length,currentAssessmentCount:current.length,
    draftCount:selected.drafts.length,submissionCount:submissions.length,
    currentSubmissionCount:latestBy(submissions,actorKey).length,
    adjudicationCount:selected.adjudications.length,
    completeAssessmentCount:comparisons.filter(value=>value.complete).length,
    pendingAssessmentCount:comparisons.filter(value=>!value.complete).length,
    disagreementCount:comparisons.filter(value=>value.valueDisagreement&&!value.adjudicationCurrent).length,
    adjudicatedAssessmentCount:comparisons.filter(value=>value.adjudicationCurrent).length,
    unresolvedImpactCount:selected.impact.filter(value=>value.status==='needs_review').length,
    reportOccurrenceCount:selected.sources.length,retainedEditionCount:new Set(selected.sources.map(value=>value.editionId)).size,
    studyCount:new Set(selected.studies.map(value=>value.studyId)).size,
    resultCount:new Set(selected.results.map(value=>value.resultId)).size,
    originalResultRegistryAttached:model.resultsAvailable,
    units:{assessmentCount:'Distinct appraisal families',assessmentEditionCount:'All retained assessment editions',
      draftCount:'Saved reviewer draft versions in this actor filter',submissionCount:'Submitted versions, including corrections',
      completeAssessmentCount:'Current assessment editions meeting their explicitly selected minimum reviewer count',
      reportOccurrenceCount:'Distinct retained report occurrences; multiple reports may describe one study'},
  };
}
export function riskOfBiasPage(state,model,options={}){
  const section=options.section??'overview',offset=options.offset??0,limit=options.limit??30;
  need(RISK_OF_BIAS_SECTIONS.includes(section),'RISK_OF_BIAS_SECTION_INVALID');
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'RISK_OF_BIAS_PAGE_INVALID');
  need(options.revision===undefined||options.revision===state.revision,'RISK_OF_BIAS_PAGE_REVISION_CHANGED');
  need(offset===0||options.revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
  const selected=selectRiskOfBias(state,model,options),overview=riskOfBiasOverview(model,selected);
  const reviewRows=selected.reviews.map(review=>{
    const subset=selectRiskOfBias(state,model,{reviewId:review.id});
    return {...clone(review),currentProtocolId:currentProtocol(model,review.id)?.id??null,overview:riskOfBiasOverview(model,subset)};
  });
  const values=['overview','reviews'].includes(section)?reviewRows:selected[section];
  need(Array.isArray(values)&&offset<=values.length,'RISK_OF_BIAS_PAGE_OFFSET_INVALID');
  const items=values.slice(offset,offset+limit);
  return {schema:RISK_OF_BIAS_SCHEMA,dossierId:state.id,revision:state.revision,section,
    reviewId:selected.reviewId,assessmentId:selected.assessmentId,
    items:clone(items),total:values.length,offset,limit,nextOffset:offset+items.length<values.length?offset+items.length:null,
    overview,review:selected.review,protocol:selected.protocol,assessment:selected.assessment,
    comparison:selected.comparison,actorDraft:selected.actorDraft?{...selected.actorDraft,current:true}:null,
    actorSubmission:selected.actorSubmission?{...selected.actorSubmission,current:true}:null};
}
function validateSourceBinding(source,editions,knownOccurrences){
  need(object(source)&&occurrence(source.occurrenceId),'PORTABLE_RISK_OF_BIAS_SOURCE_INVALID');
  const edition=editions.get(source.editionId);
  need(edition?.mode==='retained'&&source.questionId===edition.questionId&&
    source.sourceSha256===edition.raw.sha256&&source.sourceBytes===edition.raw.bytes&&
    typeof source.key==='string'&&source.occurrenceId==='o_'+digest(Buffer.from(edition.id+'\n'+source.key))&&
    knownOccurrences.get(source.occurrenceId)===source.questionId&&hash(source.contentDigest),
    'PORTABLE_RISK_OF_BIAS_SOURCE_BINDING_INVALID');
}
function validatePassage(value,editions,knownOccurrences){
  need(object(value),'PORTABLE_RISK_OF_BIAS_PASSAGE_INVALID');
  const raw=passageInput(rawPassage(value));
  validateSourceBinding(value.source,editions,knownOccurrences);
  need(value.source.occurrenceId===raw.occurrenceId&&object(value.match)&&
    ['locator-only','json-pointer','literal'].includes(value.match.mode),'PORTABLE_RISK_OF_BIAS_PASSAGE_BINDING_INVALID');
  if(value.fileName!==undefined)need(object(value.file)&&value.file.name===value.fileName&&hash(value.file.sha256)&&
    Number.isSafeInteger(value.file.bytes)&&value.file.bytes>=0&&value.contentSha256===value.file.sha256&&
    value.contentBytes===value.file.bytes,'PORTABLE_RISK_OF_BIAS_FILE_BINDING_INVALID');
  if(value.match.mode==='literal')need(raw.quote.length>0&&typeof value.match.jsonPointer==='string'&&
    value.match.units==='utf16-code-units'&&Number.isSafeInteger(value.match.start)&&value.match.start>=0&&
    value.match.end===value.match.start+raw.quote.length&&hash(value.match.textSha256)&&
    Number.isSafeInteger(value.match.utf8Start)&&value.match.utf8Start>=0&&
    Number.isSafeInteger(value.match.utf8End)&&value.match.utf8End-value.match.utf8Start===Buffer.byteLength(raw.quote,'utf8'),
    'PORTABLE_RISK_OF_BIAS_QUOTE_BINDING_INVALID');
  else if(value.match.mode==='json-pointer')need(raw.quote===''&&raw.jsonPointer!==''&&
    value.match.jsonPointer===raw.jsonPointer&&hash(value.match.valueSha256),'PORTABLE_RISK_OF_BIAS_POINTER_BINDING_INVALID');
  else need(raw.quote===''&&raw.jsonPointer==='','PORTABLE_RISK_OF_BIAS_LOCATOR_BINDING_INVALID');
}
export function validateRiskOfBiasState(state,editions,knownOccurrences){
  need(state.riskOfBiasEvents===undefined||Array.isArray(state.riskOfBiasEvents),'PORTABLE_RISK_OF_BIAS_INVALID');
  const seen=new Set(),requests=new Set();let lastRevision=0;
  for(const operation of state.riskOfBiasEvents??[]){
    need(object(operation)&&operation.schema===RISK_OF_BIAS_OPERATION_SCHEMA&&object(operation.result)&&
      operation.dossierId===state.id&&Number.isSafeInteger(operation.originalRevision)&&operation.originalRevision>=1&&
      operation.revision===operation.originalRevision+1&&operation.revision<=state.revision&&
      operation.revision>lastRevision&&hash(operation.originalRevisionSha256)&&
      typeof operation.createdAt==='string'&&Number.isFinite(Date.parse(operation.createdAt)),
      'PORTABLE_RISK_OF_BIAS_OPERATION_INVALID');
    lastRevision=operation.revision;
    const request=riskOfBiasInput(operation.request);
    need(operation.id===entityId('ro',state,request)&&operation.requestId===request.requestId&&
      operation.requestSha256===riskOfBiasDigest(request)&&same(operation.request,request)&&
      operation.originalRevision===request.expectedRevision&&operation.action===request.action&&same(operation.actor,request.actor)&&
      operation.reviewId===(operation.result.review?.id??request.reviewId),'PORTABLE_RISK_OF_BIAS_REQUEST_CHANGED');
    need(!seen.has(operation.id)&&!requests.has(operation.requestId),'PORTABLE_RISK_OF_BIAS_OPERATION_DUPLICATE');
    seen.add(operation.id);requests.add(operation.requestId);
    const {sha256,...payload}=operation;need(sha256===riskOfBiasDigest(payload),'PORTABLE_RISK_OF_BIAS_OPERATION_CHANGED');
    const result=operation.result;
    const expected={
      'create-review':['review','protocol'],'revise-protocol':['protocol'],'create-assessment':['assessment'],
      'revise-assessment':['assessment'],'save-draft':['draft'],'submit-review':['submission'],
      adjudicate:['adjudication'],'review-impact':['impactReview'],
    }[operation.action];
    need(same(Object.keys(result).sort(),[...expected].sort()),'PORTABLE_RISK_OF_BIAS_RESULT_SHAPE_INVALID');
    for(const record of Object.values(result))need(record.reviewId===undefined||record.reviewId===operation.reviewId,
      'PORTABLE_RISK_OF_BIAS_RESULT_REVIEW_MISMATCH');
    if(result.protocol)riskOfBiasProtocol(result.protocol.definition);
    if(result.assessment){
      const target=result.assessment.target;
      need(object(target)&&object(target.study)&&object(target.study.record)&&
        target.studyId===target.study.studyId&&target.studyVersion===target.study.studyVersion&&
        target.studySha256===target.study.studySha256&&target.studySha256===riskOfBiasDigest(target.study.record),
        'PORTABLE_RISK_OF_BIAS_STUDY_BINDING_INVALID');
      if(target.scope==='result')need(object(target.result)&&object(target.result.record)&&
        target.resultId===target.result.resultId&&target.resultVersion===target.result.resultVersion&&
        target.resultSha256===target.result.resultSha256&&target.resultSha256===riskOfBiasDigest(target.result.record),
        'PORTABLE_RISK_OF_BIAS_RESULT_BINDING_INVALID');
      else need(target.scope==='study'&&target.result===null,'PORTABLE_RISK_OF_BIAS_TARGET_SCOPE_INVALID');
      need(Array.isArray(target.sources)&&same(target.sources.map(value=>value.occurrenceId),target.occurrenceIds),
        'PORTABLE_RISK_OF_BIAS_TARGET_SOURCES_INVALID');
      for(const source of target.sources)validateSourceBinding(source,editions,knownOccurrences);
      for(const passage of target.designBasis)validatePassage(passage,editions,knownOccurrences);
    }
    for(const record of [result.draft,result.submission,result.adjudication].filter(Boolean))
      for(const passage of passagesIn(record))validatePassage(passage,editions,knownOccurrences);
  }
}
export async function validateRiskOfBiasTransition(previous,state,projected,registry={},options={}){
  const old=previous?.riskOfBiasEvents??[],current=state.riskOfBiasEvents??[];
  need(current.length>=old.length&&old.every((value,index)=>same(value,current[index])),
    'PORTABLE_RISK_OF_BIAS_HISTORY_CHANGED');
  const added=current.slice(old.length);
  need(added.length<=1&&added.every(value=>value.revision===state.revision&&value.originalRevision===previous?.revision&&
    value.originalRevisionSha256===state.previous),'PORTABLE_RISK_OF_BIAS_HISTORY_INVALID');
  if(!added.length)return;
  need(previous&&projected instanceof Map,'PORTABLE_RISK_OF_BIAS_PREVIOUS_STATE_REQUIRED');
  const replay=clone(previous),operation=added[0];
  await recordRiskOfBiasOperation(replay,projected,operation.request,operation.createdAt,registry,options);
  const content=value=>Object.fromEntries(Object.entries(value).filter(([key])=>
    !['revision','previous','updatedAt','change'].includes(key)));
  need(same(content(replay),content(state)),'PORTABLE_RISK_OF_BIAS_TRANSITION_CHANGED');
}
