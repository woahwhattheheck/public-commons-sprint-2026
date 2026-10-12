// MIT. Carry a saved native plan revision through the existing edited submission.
import {selectedPlan,newPlanReview,preparedReview,composePlan,planSummary,cents,reviewBasis} from './grant-plan-core.mjs';
export const PLAN_UPDATE_SCHEMA='stellar-forge.grant-plan-update.v1';
export const PLAN_TARGET_SCHEMA='stellar-forge.grant-plan-target.v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(value,message)=>{if(!value)throw new Error(message);};
const keyOf=(kind,id)=>kind+':'+id;
const findTarget=(draft,kind,id)=>(kind==='answer'?draft.answers:draft.fields).find(row=>row.id===id);
function reference(sources,sourceSha,revision,costIds=null){
  const {source,plan}=selectedPlan(sources,{sourceSha,revision});
  const ids=costIds===null?plan.scenario.future_costs.map(row=>row.id):costIds;
  need(Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.every(id=>plan.scenario.future_costs.some(row=>row.id===id)),'Retain the selected original plan packages.');
  return {sourceSha,revision,planId:plan.id,contentSha256:plan.contentSha256,costIds:[...ids]};
}
function resolve(sources,ref){
  const found=selectedPlan(sources,ref);
  need(found.plan.id===ref.planId&&found.plan.contentSha256===ref.contentSha256,'Retain the exact original plan revision.');
  reference(sources,ref.sourceSha,ref.revision,ref.costIds);
  return found;
}
function targetBasis(draft,kind,id){
  const target=findTarget(draft,kind,id);
  if(!target)return null;
  return JSON.stringify(kind==='answer'?{id,text:target.text}:{
    id,text:target.text,label:target.label,prompt:target.prompt,answerIds:target.answerIds,
    wordLimit:target.wordLimit,characterLimit:target.characterLimit,characterMethod:target.characterMethod,
    sourceUrl:target.sourceUrl,observedAt:target.observedAt,form:draft.form,
  });
}
function strings(value,keys,label){
  for(const key of keys)need(typeof value[key]==='string',label+' '+key+' must remain text.');
}
function validateBinding(row,sources){
  need(row?.schema===PLAN_TARGET_SCHEMA&&['answer','field'].includes(row.kind)&&typeof row.id==='string'&&row.id,'Retain the original planning target.');
  const {source}=resolve(sources,row);
  strings(row,['generatedText','appliedText','at'],'Planning target');
  const expected=row.costIds.length?composePlan(source,{...newPlanReview(source,row.revision),costIds:row.costIds}):'';
  need(row.generatedText===expected,'Retain the exact native text underlying this target baseline.');
  need(Number.isFinite(Date.parse(row.at)),'Retain the planning application date.');
}
/** Called by the existing draft validator for current state and each saved version. */
export function validatePlanningUpdateState(state,sources=[]){
  const bindings=state.planningTargets||[];
  need(Array.isArray(bindings),'Retain the planning target baselines.');
  need(new Set(bindings.map(row=>keyOf(row.kind,row.id))).size===bindings.length,'Retain one current planning baseline for each answer or field.');
  bindings.forEach(row=>validateBinding(row,sources));
  const update=state.planningUpdate;
  if(update===null||update===undefined)return;
  need(update.schema===PLAN_UPDATE_SCHEMA&&['reviewing','applied','kept'].includes(update.status),'Retain the native plan update review.');
  strings(update,['id','createdAt','updatedAt','fromReviewBasis','note','reviewedBasis'],'Planning update');
  need(Number.isFinite(Date.parse(update.createdAt))&&Number.isFinite(Date.parse(update.updatedAt)),'Retain the plan review dates.');
  const before=resolve(sources,update.from),after=resolve(sources,update.to);
  need(before.plan.id===after.plan.id,'Compare revisions of the same native plan.');
  need(Array.isArray(update.targets)&&update.targets.length>0,'Retain the complete plan update target review.');
  need(new Set(update.targets.map(row=>row.key)).size===update.targets.length,'Retain unique plan update targets.');
  for(const row of update.targets){
    need(['answer','field'].includes(row.kind)&&row.key===keyOf(row.kind,row.id),'Retain the exact update target.');
    strings(row,['id','label','inputText','inputBasis','incomingText','generatedBefore','proposalText','decision','note','mergeStatus'],'Plan update target');
    need(['','keep','incoming','merge','custom'].includes(row.decision),'Select an existing text choice.');
    need(row.baseText===null||typeof row.baseText==='string','Retain the accepted target text.');
    need(row.mergedText===null||typeof row.mergedText==='string','Retain the complete merged target text.');
    resolve(sources,row.from);
    reference(sources,update.to.sourceSha,update.to.revision,row.costIds);
    if(row.originalBinding!==null)validateBinding(row.originalBinding,sources);
    const incoming=selectedPlan(sources,update.to).source;
    const expected=row.costIds.length?composePlan(incoming,{...newPlanReview(incoming,update.to.revision),costIds:row.costIds}):'';
    need(row.incomingText===expected,'The incoming target text must match its selected native scope.');
    need(row.baseText===(row.originalBinding?.appliedText??null),'Retain the target’s exact applied baseline.');
    const oldSource=selectedPlan(sources,row.from).source;
    const oldText=row.from.costIds.length?composePlan(oldSource,{...newPlanReview(oldSource,row.from.revision),costIds:row.from.costIds}):'';
    need(row.generatedBefore===oldText,'Retain the target’s exact previous native scope.');
    const editorial=row.originalBinding?mergePlanText(oldText,row.baseText,expected):{status:'no-applied-baseline',text:null,conflicts:[]};
    const combined=editorial.text===null?editorial:mergePlanText(row.baseText,row.inputText,editorial.text);
    need(row.mergedText===combined.text&&row.mergeStatus===combined.status&&same(row.conflicts,combined.conflicts),'Retain the complete original text comparison.');
  }
  need(Array.isArray(update.context),'Retain the related application context.');
  for(const row of update.context)strings(row,['id','text'],'Related answer');
  if(update.status!=='reviewing'){
    need(typeof update.finishedAt==='string'&&Number.isFinite(Date.parse(update.finishedAt)),'Retain the completed plan decision date.');
    need(Array.isArray(update.outcomes),'Retain every completed target decision.');
  }
}
function changeHunks(before,after){
  const a=before.split('\n'),b=after.split('\n');
  let left=0,right=0;
  while(left<a.length&&left<b.length&&a[left]===b[left])left++;
  while(right<a.length-left&&right<b.length-left&&a[a.length-1-right]===b[b.length-1-right])right++;
  const aa=a.slice(left,a.length-right),bb=b.slice(left,b.length-right),n=aa.length,m=bb.length;
  if(!n&&!m)return [];
  if(n*m>1000000)return [{start:left,end:left+n,lines:bb}];
  const width=m+1,dp=new Uint32Array((n+1)*width);
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
    dp[i*width+j]=aa[i]===bb[j]?1+dp[(i+1)*width+j+1]:Math.max(dp[(i+1)*width+j],dp[i*width+j+1]);
  const rows=[];let i=0,j=0,active=null;
  const begin=()=>active??={start:left+i,end:left+i,lines:[]};
  const flush=()=>{if(active){rows.push(active);active=null;}};
  while(i<n||j<m){
    if(i<n&&j<m&&aa[i]===bb[j]){flush();i++;j++;}
    else if(j<m&&(i===n||dp[i*width+j+1]>=dp[(i+1)*width+j])){begin().lines.push(bb[j++]);}
    else{begin();i++;active.end=left+i;}
  }
  flush();return rows;
}
function overlaps(a,b){
  if(a.start===a.end&&b.start===b.end)return a.start===b.start;
  if(a.start===a.end)return a.start>=b.start&&a.start<=b.end;
  if(b.start===b.end)return b.start>=a.start&&b.start<=a.end;
  return a.start<b.end&&b.start<a.end;
}
/** Retain independent line edits; overlapping changes remain an explicit editorial choice. */
export function mergePlanText(base,current,incoming){
  if(current===incoming)return {status:'same-text',text:current,conflicts:[]};
  if(current===base)return {status:'native-changes',text:incoming,conflicts:[]};
  if(incoming===base)return {status:'draft-changes',text:current,conflicts:[]};
  const local=changeHunks(base,current),remote=changeHunks(base,incoming),conflicts=[];
  for(const a of local)for(const b of remote)if(overlaps(a,b)&&!same(a,b))
    conflicts.push({startLine:Math.min(a.start,b.start)+1,endLine:Math.max(a.end,b.end),draftLines:a.lines,nativeLines:b.lines});
  if(conflicts.length)return {status:'needs-resolution',text:null,conflicts};
  const hunks=[...local,...remote.filter(row=>!local.some(value=>same(row,value)))].sort((a,b)=>a.start-b.start||a.end-b.end);
  const original=base.split('\n'),out=[];let at=0;
  for(const row of hunks){out.push(...original.slice(at,row.start),...row.lines);at=row.end;}
  out.push(...original.slice(at));
  return {status:'combined-edits',text:out.join('\n'),conflicts:[]};
}
function priorBinding(draft,kind,id,from){
  const sources=draft.planSources||[];
  const binding=(draft.planningTargets||[]).find(row=>row.kind===kind&&row.id===id);
  if(binding&&resolve(sources,binding).plan.id===from.planId)return copy(binding);
  const applications=(draft.planningReview?.applications||[]).filter(row=>row.kind===kind&&row.id===id);
  for(const app of [...applications].reverse()){
    let basis;try{basis=JSON.parse(app.basis);}catch{continue;}
    if(typeof basis.sourceSha!=='string'||!Number.isSafeInteger(basis.revision))continue;
    let found;try{found=selectedPlan(sources,basis);}catch{continue;}
    if(found.plan.id!==from.planId)continue;
    const ref=reference(sources,basis.sourceSha,basis.revision,basis.costIds);
    const review={...newPlanReview(found.source,basis.revision),costIds:[...ref.costIds]};
    const applied=typeof app.afterText==='string'?app.afterText:app.mode==='replace'?app.text:null;
    if(applied===null)return null;
    return {schema:PLAN_TARGET_SCHEMA,kind,id,...ref,generatedText:composePlan(found.source,review),appliedText:applied,at:app.at};
  }
  return null;
}
function incomingIds(sources,from,to){
  const before=resolve(sources,from).plan,after=resolve(sources,to).plan;
  const all=before.scenario.future_costs.length===from.costIds.length;
  return after.scenario.future_costs.map(row=>row.id).filter(id=>all||from.costIds.includes(id));
}
function createTarget(draft,kind,id,from,to){
  const target=findTarget(draft,kind,id);need(target,'Retain the original draft target.');
  const sources=draft.planSources,binding=priorBinding(draft,kind,id,from);
  const origin=binding?reference(sources,binding.sourceSha,binding.revision,binding.costIds):
    reference(sources,from.sourceSha,from.revision,kind==='answer'?null:from.costIds);
  const ids=incomingIds(sources,origin,to),before=resolve(sources,origin),after=resolve(sources,to);
  const oldReview={...newPlanReview(before.source,origin.revision),costIds:[...origin.costIds]};
  const newReview={...newPlanReview(after.source,to.revision),costIds:ids};
  const generatedBefore=binding?.generatedText??(origin.costIds.length?composePlan(before.source,oldReview):'');
  const incomingText=ids.length?composePlan(after.source,newReview):'';
  const editorial=binding?mergePlanText(generatedBefore,binding.appliedText,incomingText):
    {status:'no-applied-baseline',text:null,conflicts:[]};
  const merged=editorial.text===null?editorial:mergePlanText(binding.appliedText,target.text,editorial.text);
  return {key:keyOf(kind,id),kind,id,label:kind==='answer'?'Delivery answer':target.label||'Unlabeled issuer field',
    from:origin,costIds:ids,originalBinding:binding,
    baseText:binding?.appliedText??null,generatedBefore,inputText:target.text,inputBasis:targetBasis(draft,kind,id),
    incomingText,mergedText:merged.text,mergeStatus:merged.status,conflicts:merged.conflicts,
    proposalText:merged.text??target.text,decision:'',note:''};
}
export function beginPlanningUpdate(draft,sourceSha,revision,{id,now=new Date().toISOString()}={}){
  const sources=draft.planSources||[],review=draft.planningReview;
  need(review,'Select the current native planning edition first.');
  const from=reference(sources,review.sourceSha,review.revision,review.costIds),to=reference(sources,sourceSha,revision);
  need(from.planId===to.planId,'Choose a revision of the same native plan for this comparison.');
  need(from.sourceSha!==to.sourceSha||from.revision!==to.revision,'Choose another retained native edition.');
  const current=draft.planningUpdate;
  if(current?.status==='reviewing'&&same(current.to,to)&&current.fromReviewBasis===JSON.stringify(review))return draft;
  const keys=[['answer','delivery']];
  for(const field of draft.fields)if(field.answerIds.includes('delivery')||
    (draft.planningTargets||[]).some(row=>row.kind==='field'&&row.id===field.id&&row.planId===from.planId)||
    review.applications.some(row=>row.kind==='field'&&row.id===field.id))keys.push(['field',field.id]);
  const stamp=id||draft.id+':plan-update:'+now;
  draft.planningUpdate={schema:PLAN_UPDATE_SCHEMA,id:stamp,status:'reviewing',createdAt:now,updatedAt:now,
    from,to,fromReviewBasis:JSON.stringify(review),
    targets:keys.map(([kind,id])=>createTarget(draft,kind,id,from,to)),
    context:draft.answers.filter(row=>['project','capacity'].includes(row.id)).map(row=>({id:row.id,text:row.text})),
    note:'',reviewedBasis:''};
  draft.updatedAt=now;return draft;
}
export function selectPlanningRevision(draft,sourceSha,revision,{id,now=new Date().toISOString()}={}){
  const next=selectedPlan(draft.planSources||[],{sourceSha,revision});
  if(draft.planningReview){
    const previous=selectedPlan(draft.planSources,draft.planningReview);
    if(previous.source.sha256===sourceSha&&previous.plan.revision===revision)return draft;
    if(previous.plan.id===next.plan.id)return beginPlanningUpdate(draft,sourceSha,revision,{id,now});
  }
  draft.planningReview=newPlanReview(next.source,revision);
  draft.planningUpdate=null;draft.updatedAt=now;return draft;
}
export function refreshPlanningUpdate(draft,{now=new Date().toISOString()}={}){
  const old=copy(draft.planningUpdate);
  need(old?.status==='reviewing','Open a current native plan update review.');
  draft.planningUpdate=null;beginPlanningUpdate(draft,old.to.sourceSha,old.to.revision,{id:old.id,now});
  const next=draft.planningUpdate;next.createdAt=old.createdAt;next.note=old.note;
  for(const row of next.targets){
    const before=old.targets.find(value=>value.key===row.key);
    if(!before)continue;
    if(before.inputBasis===row.inputBasis&&before.incomingText===row.incomingText&&same(before.from,row.from)){
      Object.assign(row,{decision:before.decision,proposalText:before.proposalText,note:before.note});
    }else{
      row.note=before.note;
      if(before.decision==='custom'){
        const combined=mergePlanText(before.inputText,row.inputText,before.proposalText);
        row.proposalText=combined.text??before.proposalText;
      }
    }
  }
  return draft;
}
export function selectedUpdateText(row){
  if(row.decision==='keep')return row.inputText;
  if(row.decision==='incoming')return row.incomingText;
  if(row.decision==='merge')return row.mergedText;
  if(row.decision==='custom')return row.proposalText;
  return null;
}
export function planningUpdateReviewBasis(update){
  return JSON.stringify({from:update.from,to:update.to,fromReviewBasis:update.fromReviewBasis,
    targets:update.targets.map(row=>({key:row.key,inputBasis:row.inputBasis,incomingText:row.incomingText,
      decision:row.decision,text:selectedUpdateText(row),note:row.note})),context:update.context,note:update.note});
}
export function choosePlanningUpdate(draft,key,decision,{text,note,now=new Date().toISOString()}={}){
  const update=draft.planningUpdate;need(update?.status==='reviewing','Open a current plan update review.');
  const row=update.targets.find(item=>item.key===key);need(row,'Select the current target.');
  need(['','keep','incoming','merge','custom'].includes(decision),'Select a text choice.');
  need(decision!=='merge'||row.mergedText!==null,'Resolve the overlapping changes in the complete answer editor.');
  row.decision=decision;
  if(text!==undefined){need(typeof text==='string','Retain the complete proposed answer.');row.proposalText=text;}
  if(note!==undefined){need(typeof note==='string','Keep the editorial note as text.');row.note=note;}
  update.reviewedBasis='';update.updatedAt=now;draft.updatedAt=now;return draft;
}
export function planningUpdateReadiness(draft){
  const update=draft.planningUpdate,issues=[];
  if(!update||update.status!=='reviewing')return {issues:['Open the native plan update review.'],stale:false};
  let stale=JSON.stringify(draft.planningReview)!==update.fromReviewBasis;
  if(stale)issues.push('The selected planning review changed. Refresh this comparison against the current draft.');
  for(const row of update.targets){
    if(targetBasis(draft,row.kind,row.id)!==row.inputBasis){stale=true;issues.push(row.label+' changed after this comparison. Refresh it to retain those edits.');}
    if(!row.decision)issues.push('Choose the complete text for '+row.label+'.');
    if(row.decision==='merge'&&row.mergedText===null)issues.push('Resolve the overlapping changes for '+row.label+'.');
    if(row.kind==='answer'&&row.decision&&!(selectedUpdateText(row)||'').trim())issues.push('Retain the complete Delivery answer.');
  }
  for(const row of update.context)if(draft.answers.find(value=>value.id===row.id)?.text!==row.text){
    stale=true;issues.push('The related '+row.id+' answer changed. Refresh the current application context.');
  }
  if(update.reviewedBasis!==planningUpdateReviewBasis(update))issues.push('Review the chosen complete answers and related application context.');
  return {issues,stale};
}
export function finishPlanningUpdate(draft,{decision='apply',now=new Date().toISOString()}={}){
  const update=draft.planningUpdate;need(update?.status==='reviewing','Open the current native plan update review.');
  need(['apply','keep-plan'].includes(decision),'Choose whether to apply this revision or retain the current plan.');
  if(decision==='keep-plan'){
    update.status='kept';update.finishedAt=now;update.updatedAt=now;update.outcomes=[];
    draft.updatedAt=now;return draft;
  }
  const readiness=planningUpdateReadiness(draft);need(!readiness.issues.length,readiness.issues.join(' '));
  const {source}=resolve(draft.planSources,update.to),review=preparedReview(source,newPlanReview(source,update.to.revision));
  review.note=update.note||draft.planningReview.note;review.summaryReviewed=true;
  draft.planningTargets??=[];update.outcomes=[];
  for(const row of update.targets){
    const target=findTarget(draft,row.kind,row.id),after=selectedUpdateText(row);
    need(target&&typeof after==='string','Retain the complete selected draft answer.');
    const kept=row.decision==='keep';
    if(!kept){
      target.text=after;
      const ref=reference(draft.planSources,update.to.sourceSha,update.to.revision,row.costIds);
      const binding={schema:PLAN_TARGET_SCHEMA,kind:row.kind,id:row.id,...ref,generatedText:row.incomingText,appliedText:after,at:now};
      draft.planningTargets=draft.planningTargets.filter(item=>keyOf(item.kind,item.id)!==row.key);
      draft.planningTargets.push(binding);
      const basis=JSON.stringify({sourceSha:ref.sourceSha,revision:ref.revision,costIds:ref.costIds});
      review.applications.push({at:now,kind:row.kind,id:row.id,mode:'replace',text:after,basis,beforeText:row.inputText,afterText:after,updateId:update.id});
      if(row.kind==='answer'&&row.id==='delivery'){review.previewText=after;review.previewBasis=reviewBasis(review);}
    }else if(row.originalBinding&&!draft.planningTargets.some(item=>keyOf(item.kind,item.id)===row.key)){
      draft.planningTargets.push(copy(row.originalBinding));
    }
    update.outcomes.push({key:row.key,kind:row.kind,id:row.id,decision:row.decision,beforeText:row.inputText,afterText:after,
      plan:kept?row.from:reference(draft.planSources,update.to.sourceSha,update.to.revision,row.costIds)});
  }
  draft.planningReview=review;update.status='applied';update.finishedAt=now;update.updatedAt=now;draft.updatedAt=now;
  return draft;
}
function changedFields(before,after){
  const keys=new Set([...Object.keys(before||{}),...Object.keys(after||{})]);
  return [...keys].sort().filter(key=>!same(before?.[key],after?.[key])).map(key=>({key,before:before?.[key]??null,after:after?.[key]??null}));
}
export function planRevisionChanges(sources,from,to){
  const before=resolve(sources,from),after=resolve(sources,to);
  const a=planSummary(before.source,before.plan.revision),b=planSummary(after.source,after.plan.revision);
  const costIds=[...new Set([...a.costs.map(row=>row.id),...b.costs.map(row=>row.id)])];
  const packages=costIds.map(id=>{
    const old=a.costs.find(row=>row.id===id)||null,next=b.costs.find(row=>row.id===id)||null;
    return {id,status:!old?'added':!next?'removed':same(old,next)?'unchanged':'changed',before:old,after:next,fields:changedFields(old,next)};
  });
  const tranches=a.tranches.map((row,i)=>({tranche:i+1,before:{...row.milestone,amount:row.amount,note:row.note},
    after:{...b.tranches[i].milestone,amount:b.tranches[i].amount,note:b.tranches[i].note},
    fields:changedFields({...row.milestone,amount:row.amount,note:row.note},{...b.tranches[i].milestone,amount:b.tranches[i].amount,note:b.tranches[i].note})}));
  const common=before.source.document.revisions.filter(row=>after.source.document.revisions.some(value=>value.revision===row.revision))
    .map(row=>({revision:row.revision,before:row.contentSha256,after:after.source.document.revisions.find(value=>value.revision===row.revision).contentSha256}));
  return {planId:before.plan.id,before:{award:a.award,hours:a.hours,duration:a.duration,packages:a.costs.length},
    after:{award:b.award,hours:b.hours,duration:b.duration,packages:b.costs.length},
    amountDeltaCents:(cents(b.award)-cents(a.award)).toString(),packages,tranches,
    payments:a.payouts.map((row,i)=>({tranche:row.tranche,before:row,after:b.payouts[i],fields:changedFields(row,b.payouts[i])})),
    planning:changedFields(before.plan.planning,after.plan.planning),
    cash:{before:a.cash??null,after:b.cash??null},capacity:{before:a.capacity??null,after:b.capacity??null},
    sharedRevisions:common,changedSharedRevisions:common.filter(row=>row.before!==row.after)};
}
export function exportPlanningUpdate(draft){
  const update=draft.planningUpdate;need(update,'Open a retained native plan comparison.');
  validatePlanningUpdateState(draft,draft.planSources||[]);
  const before=resolve(draft.planSources,update.from),after=resolve(draft.planSources,update.to);
  return {schema:PLAN_UPDATE_SCHEMA+'.delivery',draftId:draft.id,title:draft.title,
    review:copy(update),changes:planRevisionChanges(draft.planSources,update.from,update.to),
    before:{filename:before.source.filename,bytes:before.source.bytes,sha256:before.source.sha256,plan:copy(before.plan)},
    after:{filename:after.source.filename,bytes:after.source.bytes,sha256:after.source.sha256,plan:copy(after.plan)},
    currentTargets:update.targets.map(row=>({kind:row.kind,id:row.id,text:findTarget(draft,row.kind,row.id)?.text??null})),
    continuation:'Open the complete submission draft to retain every original planning file, saved version and editable review choice.'};
}
