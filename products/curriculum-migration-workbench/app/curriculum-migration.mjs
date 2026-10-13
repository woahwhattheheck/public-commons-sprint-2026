/* Curriculum dataset migration and retained workbench plans.
 * Uses the existing workbench model and the source-aligned coverage module.
 */
import {copy, canonical, compareValues, applyMappings, validate, receiveWorkspace} from './model.mjs';
import {inspectCurriculumDataset} from './curriculum-coverage.mjs';

export const CURRICULUM_PLAN_FORMAT = 'curriculum-migration-plan.v1';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function requireValue(ok,message){if(!ok)throw new Error(message);}
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
function stamp(context){
  requireValue(typeof context?.actor==='string'&&context.actor.trim(),'Enter the operating engineer.');
  requireValue(typeof context.at==='string'&&Number.isFinite(Date.parse(context.at)),'An operation time is required.');
  return {actor:context.actor.trim(),at:context.at};
}
function event(w,type,detail,context){
  w.revision++;w.history.push({sequence:w.revision,type,...stamp(context),detail:copy(detail)});return w;
}
function group(rows,selector){
  const out=new Map();
  for(const row of rows){const key=selector(row);const list=out.get(key)||[];list.push(row);out.set(key,list);}
  return out;
}
function occurrence(row){
  return {kind:row.kind,pointer:row.pointer,key:row.key,identity:copy(row.identity),
    identityValid:row.identityValid,order:row.order,datasetId:row.datasetId,
    editionId:row.editionId,namespace:row.namespace};
}
function checkMapping(m,index){
  requireValue(object(m),'Mapping '+index+' must be an object.');
  requireValue(['unit','lesson'].includes(m.kind),'Mapping '+index+' needs unit or lesson kind.');
  const stem=m.kind==='unit'?'/sequence/':'/lessons/';
  requireValue(typeof m.from==='string'&&m.from.startsWith(stem)&&/^(0|[1-9][0-9]*)$/.test(m.from.slice(stem.length)),'Mapping '+index+' needs an original occurrence pointer.');
  requireValue(typeof m.to==='string'&&m.to.startsWith(stem)&&/^(0|[1-9][0-9]*)$/.test(m.to.slice(stem.length)),'Mapping '+index+' needs a candidate occurrence pointer.');
  requireValue(typeof m.reason==='string'&&m.reason.trim(),'Mapping '+index+' needs its engineering reason.');
  return {kind:m.kind,from:m.from,to:m.to,reason:m.reason.trim()};
}
function compareKind(kind,original,candidate,mappings){
  const before=original[kind==='unit'?'units':'lessons'];
  const after=candidate[kind==='unit'?'units':'lessons'];
  const aByPointer=new Map(before.map(r=>[r.pointer,r])), bByPointer=new Map(after.map(r=>[r.pointer,r]));
  const aByKey=group(before.filter(r=>r.identityValid),r=>r.key),bByKey=group(after.filter(r=>r.identityValid),r=>r.key);
  const usedA=new Set(),usedB=new Set(),matches=[];
  function match(a,b,method,reason){
    requireValue(!usedA.has(a.pointer),'Original occurrence is mapped more than once: '+a.pointer);
    requireValue(!usedB.has(b.pointer),'Candidate occurrence is mapped more than once: '+b.pointer);
    usedA.add(a.pointer);usedB.add(b.pointer);
    const differences=compareValues(a.record,b.record);
    matches.push({id:kind+':'+a.pointer+'->'+b.pointer,kind,method,...(reason?{reason}:{}),
      original:occurrence(a),candidate:occurrence(b),identityChanged:a.key!==b.key,
      differences,changed:differences.length>0,positionChanged:a.order!==b.order});
  }
  for(const m of mappings.filter(x=>x.kind===kind)){
    const a=aByPointer.get(m.from),b=bByPointer.get(m.to);
    requireValue(a&&b,'Mapping occurrence is absent: '+m.from+' -> '+m.to);
    match(a,b,'explicit',m.reason);
  }
  // Uniqueness is established on the complete edition, before explicit selection.
  // Selecting one occurrence never silently resolves another duplicate.
  for(const a of before){
    if(!a.identityValid||usedA.has(a.pointer))continue;
    const aa=aByKey.get(a.key)||[],bb=bByKey.get(a.key)||[];
    if(aa.length===1&&bb.length===1&&!usedB.has(bb[0].pointer))match(a,bb[0],'identity');
  }
  matches.sort((a,b)=>a.original.order-b.original.order);
  const ambiguities=[];
  for(const key of new Set([...aByKey.keys(),...bByKey.keys()])){
    const aa=aByKey.get(key)||[],bb=bByKey.get(key)||[];
    if(aa.length<=1&&bb.length<=1)continue;
    const unresolvedA=aa.filter(r=>!usedA.has(r.pointer)),unresolvedB=bb.filter(r=>!usedB.has(r.pointer));
    if(unresolvedA.length||unresolvedB.length)ambiguities.push({key,
      originalCandidates:aa.map(occurrence),candidateCandidates:bb.map(occurrence),
      unresolvedOriginal:unresolvedA.map(r=>r.pointer),unresolvedCandidate:unresolvedB.map(r=>r.pointer)});
  }
  const originalOrder=matches.map(m=>m.id);
  const candidateOrder=[...matches].sort((a,b)=>a.candidate.order-b.candidate.order).map(m=>m.id);
  return {kind,matches,
    unmatchedOriginal:before.filter(r=>!usedA.has(r.pointer)).map(occurrence),
    unmatchedCandidate:after.filter(r=>!usedB.has(r.pointer)).map(occurrence),
    invalidOriginal:before.filter(r=>!r.identityValid).map(occurrence),
    invalidCandidate:after.filter(r=>!r.identityValid).map(occurrence),
    ambiguities,order:{changed:canonical(originalOrder)!==canonical(candidateOrder),original:originalOrder,candidate:candidateOrder}};
}
export function compareCurriculumDatasets(original,candidate,{mappings=[]}={}){
  requireValue(Array.isArray(mappings),'Occurrence mappings must be an array.');
  const normalized=mappings.map(checkMapping);
  // Coverage performs strict JSON copying before any comparison. No JSON coercion,
  // duplicate collapse, title-derived identity, or array normalization is applied.
  const a=inspectCurriculumDataset(original),b=inspectCurriculumDataset(candidate);
  const units=compareKind('unit',a,b,normalized),lessons=compareKind('lesson',a,b,normalized);
  const wireDifferences=compareValues(a.dataset.body,b.dataset.body);
  const relationshipChanges=units.matches.flatMap(m=>m.differences
    .filter(d=>d.path==='/unitLessons'||d.path.startsWith('/unitLessons/'))
    .map(d=>({relationshipKind:'unit-reference',originalPointer:m.original.pointer,candidatePointer:m.candidate.pointer,...d})))
    .concat(lessons.matches.flatMap(m=>m.differences.filter(d=>d.path==='/unitSlug')
      .map(d=>({relationshipKind:'lesson-membership',originalPointer:m.original.pointer,candidatePointer:m.candidate.pointer,...d}))));
  const ambiguities=units.ambiguities.length+lessons.ambiguities.length;
  const unmatched=units.unmatchedOriginal.length+units.unmatchedCandidate.length+lessons.unmatchedOriginal.length+lessons.unmatchedCandidate.length;
  const invalid=units.invalidOriginal.length+units.invalidCandidate.length+lessons.invalidOriginal.length+lessons.invalidCandidate.length;
  const complete=a.summary.complete&&b.summary.complete;
  return freeze({schema:'curriculum-dataset-comparison.v1',original:a,candidate:b,mappings:normalized,
    units,lessons,wireDifferences,relationshipChanges,
    summary:{matchedUnits:units.matches.length,matchedLessons:lessons.matches.length,
      changedUnits:units.matches.filter(x=>x.changed).length,changedLessons:lessons.matches.filter(x=>x.changed).length,
      unmatchedOccurrences:unmatched,ambiguousIdentities:ambiguities,invalidIdentities:invalid,
      unitOrderChanged:units.order.changed,lessonOrderChanged:lessons.order.changed,
      wireDifferences:wireDifferences.length,relationshipChanges:relationshipChanges.length,
      referencesComplete:complete,status:complete&&!ambiguities&&!unmatched&&!invalid&&!wireDifferences.length?'MATCH':'REVIEW'}});
}
function validateResponse(response,lane){
  requireValue(object(response)&&Number.isInteger(response.status)&&response.status>=200&&response.status<300,lane+' must retain a successful HTTP response.');
  requireValue(own(response,'body')&&response.provenance?.kind&&response.provenance?.label,lane+' needs its original body and provenance.');
  requireValue(typeof response.contentType==='undefined'||typeof response.contentType==='string',lane+' content type must be a string when present.');
}
function editionSnapshot(edition){
  requireValue(edition&&edition.id&&edition.provenance&&own(edition,'bulkSchema'),'Selected edition must retain its bulk schema and provenance.');
  return copy({id:edition.id,provenance:edition.provenance,bulkSchema:edition.bulkSchema});
}
function currentInputs(w,c,namespaces){
  requireValue(c.operationKey==='BULK','Choose a BULK case for curriculum planning.');
  requireValue(object(namespaces)&&typeof namespaces.original==='string'&&namespaces.original.trim()&&typeof namespaces.candidate==='string'&&namespaces.candidate.trim(),'Select explicit original and candidate identifier namespaces.');
  validateResponse(c.responses.original,'Original');validateResponse(c.responses.candidate,'Candidate');
  return {caseId:c.id,caseRevision:c.revision,
    originalEdition:editionSnapshot(w.editions.find(e=>e.id===c.sourceEditionId)),
    candidateEdition:editionSnapshot(w.editions.find(e=>e.id===c.targetEditionId)),
    original:copy(c.responses.original),candidate:copy(c.responses.candidate),
    fieldMappings:copy(c.mappings),namespaces:copy(namespaces)};
}
function dataset(input,lane,body){
  const edition=lane==='original'?input.originalEdition:input.candidateEdition;
  return {id:input.caseId+':'+lane,editionId:edition.id,namespace:input.namespaces[lane],
    body,provenance:copy(input[lane].provenance)};
}
function compute(input,mappings){
  // Preserve the raw source; run explicit existing-model field transformations on a copy.
  const rawOriginal=inspectCurriculumDataset(dataset(input,'original',input.original.body));
  const mapped=applyMappings(rawOriginal.dataset.body,input.fieldMappings);
  const comparison=compareCurriculumDatasets(dataset(input,'original',mapped.body),dataset(input,'candidate',input.candidate.body),{mappings});
  const originalValidation=validate(input.original.body,input.originalEdition.bulkSchema);
  const candidateValidation=validate(input.candidate.body,input.candidateEdition.bulkSchema);
  const expectedValidation=validate(mapped.body,input.candidateEdition.bulkSchema);
  const transportDifferences=[];
  if(input.original.status!==input.candidate.status)transportDifferences.push({path:'/@http/status',kind:'status',before:input.original.status,after:input.candidate.status});
  // Preserve an absent media type separately from an explicitly supplied value.
  const mediaA=own(input.original,'contentType')?{contentType:input.original.contentType}:{};
  const mediaB=own(input.candidate,'contentType')?{contentType:input.candidate.contentType}:{};
  transportDifferences.push(...compareValues(mediaA,mediaB).map(d=>({...d,path:'/@http'+d.path})));
  const status=comparison.summary.status==='MATCH'&&rawOriginal.summary.complete&&originalValidation.valid&&candidateValidation.valid&&expectedValidation.valid&&!transportDifferences.length?'MATCH':'REVIEW';
  return {rawOriginal,expected:copy(mapped.body),appliedFieldMappings:copy(mapped.applied),comparison,
    originalValidation,candidateValidation,expectedValidation,transportDifferences,status};
}
export function planCurriculumCase(workspace,caseId,{namespaces,mappings=[]},context){
  const w=receiveCurriculumWorkspace(workspace),c=w.cases.find(x=>x.id===caseId);requireValue(c,'Case not found.');
  requireValue(!own(c,'curriculumPlans')||Array.isArray(c.curriculumPlans),'Retained curriculum plans must be an array.');
  const input=currentInputs(w,c,namespaces),computed=compute(input,mappings);
  const plans=c.curriculumPlans||(c.curriculumPlans=[]);
  const plan={format:CURRICULUM_PLAN_FORMAT,id:c.id+'-curriculum-'+(plans.length+1),...stamp(context),
    input,mappings:copy(computed.comparison.mappings),...computed};
  requireValue(!plans.some(p=>p.id===plan.id),'Curriculum plan identity already exists.');
  plans.push(copy(plan));
  return event(w,'curriculum-plan-created',{caseId:c.id,planId:plan.id,caseRevision:c.revision,status:plan.status},context);
}
function planFor(w,caseId,planId){
  const c=w.cases.find(x=>x.id===caseId);requireValue(c,'Case not found.');
  const p=c.curriculumPlans?.find(p=>p.id===planId);requireValue(p,'Curriculum plan not found.');
  return {c,p};
}
function isCurrent(w,c,p){
  try{return canonical(currentInputs(w,c,p.input.namespaces))===canonical(p.input);}catch{return false;}
}
export function decideCurriculumPlan(workspace,caseId,{planId,outcome,note},context){
  requireValue(['accepted','changes-required'].includes(outcome)&&typeof note==='string'&&note.trim(),'Choose an outcome and record the engineering decision.');
  const w=receiveCurriculumWorkspace(workspace),{c,p}=planFor(w,caseId,planId);
  requireValue(isCurrent(w,c,p),'The case or selected edition changed. Create a current curriculum plan before deciding.');
  requireValue(!own(c,'curriculumDecisions')||Array.isArray(c.curriculumDecisions),'Retained curriculum decisions must be an array.');
  const decision={planId,outcome,note:note.trim(),...stamp(context)};
  (c.curriculumDecisions||(c.curriculumDecisions=[])).push(decision);
  return event(w,'curriculum-plan-decided',{caseId,planId,outcome,note:decision.note},context);
}
export function receiveCurriculumWorkspace(value){
  const w=receiveWorkspace(value);
  const caseIds=new Set(w.cases.map(c=>c.id));
  for(const h of w.history.filter(h=>['curriculum-plan-created','curriculum-plan-decided'].includes(h.type))){
    requireValue(caseIds.has(h.detail?.caseId),'Curriculum history names an absent case.');
    if(h.type==='curriculum-plan-decided')requireValue(w.history.some(created=>created.type==='curriculum-plan-created'&&created.detail?.caseId===h.detail.caseId&&created.detail?.planId===h.detail.planId&&created.sequence<h.sequence),'Curriculum decision precedes its plan.');
  }
  for(const c of w.cases){
    if(own(c,'curriculumPlans'))requireValue(Array.isArray(c.curriculumPlans),'Curriculum plans must be an array.');
    if(own(c,'curriculumDecisions'))requireValue(Array.isArray(c.curriculumDecisions),'Curriculum decisions must be an array.');
    const ids=new Set();
    for(const p of c.curriculumPlans||[]){
      requireValue(p?.format===CURRICULUM_PLAN_FORMAT&&typeof p.id==='string'&&p.id&&!ids.has(p.id),'Curriculum plan identity is invalid.');
      ids.add(p.id);stamp(p);
      requireValue(p.input?.caseId===c.id&&Number.isInteger(p.input.caseRevision)&&p.input.caseRevision>=0&&Number.isInteger(c.revision)&&p.input.caseRevision<=c.revision,'Curriculum plan case identity is invalid.');
      requireValue(Array.isArray(p.mappings)&&Array.isArray(p.input.fieldMappings),'Retained mapping lists are incomplete.');
      requireValue(object(p.input.namespaces)&&p.input.originalEdition?.id&&p.input.candidateEdition?.id,'Retained dataset editions are incomplete.');
      validateResponse(p.input.original,'Retained original');validateResponse(p.input.candidate,'Retained candidate');
      editionSnapshot(p.input.originalEdition);editionSnapshot(p.input.candidateEdition);
      const expected=compute(p.input,p.mappings);
      requireValue(canonical(p.mappings)===canonical(expected.comparison.mappings),'Retained occurrence mappings are not canonical.');
      for(const key of Object.keys(expected))requireValue(canonical(p[key])===canonical(expected[key]),'Retained curriculum computation differs at '+p.id+'.'+key);
      const events=w.history.filter(h=>h.type==='curriculum-plan-created'&&h.detail?.caseId===c.id&&h.detail?.planId===p.id);
      requireValue(events.length===1&&events[0].detail.caseRevision===p.input.caseRevision&&events[0].detail.status===p.status&&events[0].actor===p.actor&&events[0].at===p.at,'Curriculum plan history is incomplete: '+p.id);
    }
    for(const d of c.curriculumDecisions||[]){
      requireValue(ids.has(d.planId)&&['accepted','changes-required'].includes(d.outcome)&&typeof d.note==='string'&&d.note.trim(),'Retained curriculum decision is invalid.');stamp(d);
    }
    // Every persisted decision must have one matching history event, including repeats.
    const decisions=group(c.curriculumDecisions||[],canonical);
    const events=group(w.history.filter(h=>h.type==='curriculum-plan-decided'&&h.detail?.caseId===c.id)
      .map(h=>({planId:h.detail.planId,outcome:h.detail.outcome,note:h.detail.note,actor:h.actor,at:h.at})),canonical);
    requireValue(decisions.size===events.size&&[...decisions].every(([key,rows])=>events.get(key)?.length===rows.length),'Curriculum decision history is incomplete: '+c.id);
    const created=w.history.filter(h=>h.type==='curriculum-plan-created'&&h.detail?.caseId===c.id);
    requireValue(created.length===ids.size,'Curriculum plan history has an unretained plan: '+c.id);
  }
  return w;
}
export function curriculumPortfolio(workspace){
  const w=receiveCurriculumWorkspace(workspace);
  return w.cases.filter(c=>c.operationKey==='BULK').map(c=>{
    const p=c.curriculumPlans?.at(-1),current=p?isCurrent(w,c,p):false;
    const decision=(c.curriculumDecisions||[]).filter(d=>d.planId===p?.id).at(-1);
    return {caseId:c.id,name:c.name,planId:p?.id??null,state:!p?'READY':current?p.status:'CHANGED',
      sourceEditionId:c.sourceEditionId,targetEditionId:c.targetEditionId,
      decision:current&&decision?decision.outcome:'pending',
      summary:p?copy(p.comparison.summary):null};
  });
}
export function curriculumReviewRows(plan){
  requireValue(plan?.format===CURRICULUM_PLAN_FORMAT,'Select a curriculum plan.');
  const rows=[];
  for(const [lane,inspection] of [['original',plan.rawOriginal],['expected',plan.comparison.original],['candidate',plan.comparison.candidate]]){
    for(const issue of inspection.issues)rows.push({section:'coverage',lane,...copy(issue)});
  }
  for(const name of ['units','lessons']){
    const comparison=plan.comparison[name];
    for(const m of comparison.matches)for(const d of m.differences)rows.push({section:'record-change',entityKind:comparison.kind,
      originalPointer:m.original.pointer,candidatePointer:m.candidate.pointer,method:m.method,...copy(d)});
    for(const lane of ['Original','Candidate'])for(const r of comparison['unmatched'+lane])rows.push({section:'unmatched',lane:lane.toLowerCase(),...copy(r)});
    for(const ambiguity of comparison.ambiguities)rows.push({section:'ambiguous',kind:comparison.kind,...copy(ambiguity)});
    if(comparison.order.changed)rows.push({section:'order',kind:comparison.kind,...copy(comparison.order)});
  }
  for(const lane of ['original','candidate','expected'])for(const category of ['errors','unsupported']){
    for(const issue of plan[lane+'Validation'][category])rows.push({section:'schema',lane,category,...copy(issue)});
  }
  rows.push(...plan.comparison.wireDifferences.map(d=>({section:'wire',...copy(d)})));
  rows.push(...plan.transportDifferences.map(d=>({section:'http',...copy(d)})));
  return rows;
}
