// MIT. Exact editorial review bases inside the original submission draft.
export const REQUIREMENT_REVIEW_SCHEMA='stellar-forge.grant-required-content-review.v1';
export const REQUIREMENT_COVERAGE_SCHEMA='stellar-forge.grant-required-content-coverage.v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const need=(value,message)=>{if(!value)throw new Error(message);};
const text=(value,name)=>need(typeof value==='string',name+' must be text.');
const object=(value,name)=>need(value&&typeof value==='object'&&!Array.isArray(value),name+' must be an object.');
const list=(value,name)=>need(Array.isArray(value),name+' must be a list.');
const statuses=['unreviewed','covered','needs-edit','not-applicable'];
export function reviewCanonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){need(Number.isFinite(value),'Keep finite review values.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(reviewCanonical).join(',')+']';
  object(value,'Review value');return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+reviewCanonical(value[key])).join(',')+'}';
}
const same=(a,b)=>reviewCanonical(a)===reviewCanonical(b);
function ids(values,name,allowed=null){
  list(values,name);need(new Set(values).size===values.length,'Select each '+name+' once.');
  values.forEach(value=>{text(value,name);need(value.length>0&&(!allowed||allowed.includes(value)),'Select an original '+name+'.');});
}
function selection(value,answerIds){
  object(value,'Review selection');ids(value.answerIds,'answer identity',answerIds);ids(value.fieldIds,'field identity');
}
function decision(value){
  object(value,'Editorial decision');text(value.actor,'Reviewer');text(value.note,'Decision note');
  need(statuses.includes(value.status),'Select an editorial decision.');
}
function validateBasis(value,answerIds){
  object(value,'Complete reviewed text');selection(value.selection,answerIds);
  object(value.criteria,'Selected published criteria');
  for(const key of ['url','reviewedAt'])text(value.criteria[key],'Criteria '+key);
  ids(value.fieldOrder,'reviewed field order');need(same([...value.fieldOrder].sort(),[...value.selection.fieldIds].sort()),'Retain each reviewed field in its original output order.');
  list(value.answers,'Reviewed answers');list(value.fields,'Reviewed fields');list(value.dependencies,'Field source answers');
  ids(value.answers.map(row=>row.id),'reviewed answer identity',answerIds);
  ids(value.dependencies.map(row=>row.id),'field source answer identity',answerIds);
  need(same(value.answers.map(row=>row.id),value.selection.answerIds),'Retain the complete ordered answer selection.');
  need(same(value.fields.map(row=>row.id),value.selection.fieldIds),'Retain the complete ordered field selection.');
  for(const row of [...value.answers,...value.dependencies]){object(row,'Complete reviewed answer');text(row.text,'Reviewed answer text');}
  for(const row of value.fields){
    object(row,'Complete reviewed field');
    for(const key of ['id','label','prompt','text','sourceUrl','observedAt','characterMethod'])text(row[key],'Reviewed field '+key);
    ids(row.answerIds,'field answer identity',answerIds);
    for(const key of ['wordLimit','characterLimit'])need(row[key]===null||Number.isSafeInteger(row[key])&&row[key]>0,'Retain the original field limit.');
    need(['unspecified','characters','utf16','utf8Bytes'].includes(row.characterMethod),'Retain the original field counting rule.');
  }
  const dependencies=[...new Set(value.fields.flatMap(row=>row.answerIds))];
  need(same(dependencies,value.dependencies.map(row=>row.id)),'Retain every selected field source answer.');
  if(value.fields.length){object(value.form,'Reviewed issuer form');for(const key of ['name','url','observedAt','notes'])text(value.form[key],'Reviewed form '+key);}
  else need(value.form===null,'Canonical-only review has no issuer-field context.');
}
export function validateRequirementReviews(state,answerIds){
  for(const review of state.reviews){
    if(review.contentReview!==undefined){
      const value=review.contentReview;object(value,'Recorded required-content review');
      need(value.schema===REQUIREMENT_REVIEW_SCHEMA&&value.requirementId===review.id,'Retain the original requirement review identity.');
      decision(value);need(value.status!=='unreviewed'&&value.actor.trim()&&value.note.trim(),'Retain the named reviewer, explicit decision and supporting note.');
      text(value.reviewedAt,'Review time');need(Number.isFinite(Date.parse(value.reviewedAt)),'Retain the original review time.');
      validateBasis(value.basis,answerIds);
      need(value.status!=='covered'||value.basis.answers.length+value.basis.fields.length>0,'A covered decision needs its complete supporting text.');
    }
    if(review.contentReviewDraft!==undefined){
      decision(review.contentReviewDraft);selection(review.contentReviewDraft,answerIds);
    }
  }
  return state;
}
export function requirementReviewInput(review){
  return clone(review.contentReviewDraft||{
    actor:review.contentReview?.actor||'',status:review.status,note:review.note,
    answerIds:review.contentReview?.basis.selection.answerIds||review.answers,fieldIds:review.contentReview?.basis.selection.fieldIds||[],
  });
}
function answerRows(draft,selected,missing){
  return selected.map(id=>{const row=draft.answers.find(item=>item.id===id);if(!row){missing.push('answer:'+id);return {id,missing:true};}return {id,text:row.text};});
}
function basisOf(draft,selected,criteria,{strict=false}={}){
  const missing=[];
  const fields=selected.fieldIds.map(id=>{
    const row=draft.fields.find(item=>item.id===id);
    if(!row){missing.push('field:'+id);return {id,missing:true};}
    return clone(Object.fromEntries(['id','label','prompt','text','sourceUrl','observedAt','characterMethod','wordLimit','characterLimit','answerIds'].map(key=>[key,row[key]])));
  });
  const value={
    selection:clone(selected),criteria:clone(criteria),
    fieldOrder:draft.fields.filter(row=>selected.fieldIds.includes(row.id)).map(row=>row.id),
    answers:answerRows(draft,selected.answerIds,missing),fields,
    dependencies:answerRows(draft,[...new Set(fields.flatMap(row=>row.answerIds||[]))],missing),
    form:fields.length?clone(draft.form):null,
  };
  if(strict)need(!missing.length,'Select current answers and issuer fields before recording this review.');
  return {value,missing};
}
export function captureRequirementReview(draft,id,input,{at=new Date().toISOString(),criteria}={}){
  const previous=draft.reviews.find(row=>row.id===id);need(previous,'Select an original requirement.');
  decision(input);selection(input,draft.answers.map(row=>row.id));
  need(input.status!=='unreviewed','Choose the editorial decision to record.');
  need(input.actor.trim()&&input.note.trim(),'Name the reviewer and record the supporting location or reason.');
  need(input.status!=='covered'||input.answerIds.length+input.fieldIds.length>0,'Select the complete answer or issuer field supporting this decision.');
  need(Number.isFinite(Date.parse(at)),'Record the review time.');
  const selected={answerIds:[...input.answerIds],fieldIds:[...input.fieldIds]};
  const basis=basisOf(draft,selected,criteria,{strict:true}).value;
  const contentReview={schema:REQUIREMENT_REVIEW_SCHEMA,requirementId:id,reviewedAt:at,
    actor:input.actor,status:input.status,note:input.note,basis};
  const result={...clone(previous),status:input.status,note:input.note,answers:[...input.answerIds],contentReview};
  delete result.contentReviewDraft;return result;
}
function comparisons(before,after,kind){
  const old=new Map(before.map(row=>[row.id,row])),next=new Map(after.map(row=>[row.id,row]));
  return [...new Set([...old.keys(),...next.keys()])].map(id=>{
    const a=old.get(id)||null,b=next.get(id)||null;
    return {kind,id,before:a,after:b,status:b?.missing||!b?'removed':!a?'added':same(a,b)?'unchanged':'changed'};
  });
}
export function requirementReviewStatus(draft,id,{criteria}={}){
  const review=draft.reviews.find(row=>row.id===id);need(review,'Select an original requirement.');
  const retained=review.contentReview||null;
  if(!retained)return {id,status:'unbound',decision:review.status,actor:'',reviewedAt:null,note:review.note,
    basis:null,current:null,rows:[],changes:[],missing:[],pending:!!review.contentReviewDraft,
    meaning:'Historical editorial decision with no retained exact text basis. Record a first text-bound review.'};
  const observed=basisOf(draft,retained.basis.selection,criteria||retained.basis.criteria);
  const rows=[...comparisons(retained.basis.answers,observed.value.answers,'answer'),
    ...comparisons(retained.basis.fields,observed.value.fields,'field'),
    ...comparisons(retained.basis.dependencies,observed.value.dependencies,'field-source-answer')];
  const changes=[];
  for(const key of ['form','criteria','fieldOrder'])if(!same(retained.basis[key],observed.value[key]))changes.push({kind:key,before:clone(retained.basis[key]),after:clone(observed.value[key])});
  const beforeDecision={status:retained.status,note:retained.note,answers:retained.basis.selection.answerIds};
  const currentDecision={status:review.status,note:review.note,answers:review.answers};
  if(!same(beforeDecision,currentDecision))changes.push({kind:'decision',before:beforeDecision,after:clone(currentDecision)});
  const changed=observed.missing.length||rows.some(row=>row.status!=='unchanged')||changes.length;
  return {id,status:changed?'changed':'current',decision:retained.status,actor:retained.actor,
    reviewedAt:retained.reviewedAt,note:retained.note,basis:clone(retained.basis),current:observed.value,rows,changes,
    missing:observed.missing,pending:!!review.contentReviewDraft,
    meaning:'An editorial decision applies only to the retained complete selected text and context; it is not issuer approval.'};
}
export function requirementCoverage(draft,{outputKind='answers',criteria,includeText=true}={}){
  need(['answers','fields'].includes(outputKind),'Select the actual prepared output.');
  const reviews=draft.reviews.map(review=>{
    const current=requirementReviewStatus(draft,review.id,{criteria});
    const relevant=current.basis?.selection[outputKind==='fields'?'fieldIds':'answerIds']||[];
    const itemSet=new Set((outputKind==='fields'?draft.fields:draft.answers).map(row=>row.id));
    const supported=relevant.length>0&&relevant.every(id=>itemSet.has(id));
    const readiness=current.status==='unbound'?'unbound':current.status==='changed'?'changed':
      current.pending?'pending-decision':current.decision==='covered'&&!supported?'different-output':
      current.decision==='covered'?'reviewed':current.decision==='not-applicable'?'reviewed-not-applicable':'needs-edit';
    const row={id:review.id,...current,readiness,outputItemIds:[...relevant]};
    if(!includeText){delete row.basis;delete row.current;delete row.rows;delete row.changes;}
    return row;
  });
  return {schema:REQUIREMENT_COVERAGE_SCHEMA,outputKind,criteria:criteria?clone(criteria):null,includeText,reviews,
    attention:reviews.filter(row=>!['reviewed','reviewed-not-applicable'].includes(row.readiness)).map(row=>row.id),
    meaning:'Exact retained editorial review of selected submission text. No automatic content sufficiency, issuer acceptance or grant eligibility is asserted.'};
}
export function requirementCoverageHtml(value){
  const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const pre=value=>'<pre>'+escape(typeof value==='string'?value:JSON.stringify(value,null,2))+'</pre>';
  return '<section><h2>Required content at preparation</h2><p>'+escape(value.meaning)+'</p>'+
    value.reviews.map(row=>'<section><h3>'+escape(row.id)+' · '+escape(row.readiness)+'</h3><p>'+
      escape(row.actor||'No text-bound reviewer')+' · '+escape(row.reviewedAt||'No recorded text basis')+' · '+escape(row.decision)+'</p>'+
      pre(row.note)+'<p>Selected '+escape(value.outputKind)+': '+escape(row.outputItemIds.join(', ')||'none')+'</p>'+
      (row.basis?'<details><summary>Complete reviewed text and context</summary>'+pre(row.basis)+'</details>':'')+
      (row.status==='changed'?'<details><summary>Complete current text and changes at preparation</summary>'+pre(row.current)+pre(row.changes)+'</details>':'')+
      '</section>').join('')+'</section>';
}
