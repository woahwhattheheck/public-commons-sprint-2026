// MIT. Review a later native plan inside the original submission editor.
import {beginPlanningUpdate,refreshPlanningUpdate,finishPlanningUpdate,choosePlanningUpdate,
  planningUpdateReadiness,planningUpdateReviewBasis,selectedUpdateText,planRevisionChanges,exportPlanningUpdate} from './grant-plan-update-core.mjs';
import {retainVersion,validateDraft,fieldStatus,measureText,outputText} from './grant-submission-core.mjs';
import {selectedPlan,usd} from './grant-plan-core.mjs';
const pretty=value=>value===null||value===undefined?'Not entered':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const title=key=>({amount_usd:'Price USD',estimated_hours:'Estimated hours',assumed_hourly_rate_usd:'Assumed hourly rate USD',
  remaining_work:'Remaining work',measurable_proof:'Completion assessment',start_day:'Start day',end_day:'End day',
  tranche:'Tranche',category:'Category',future_only:'Future work',submit_day:'Submission day',deliverable:'Deliverable',
  amount:'Development cost USD',note:'Planning note',usd:'Payment USD',release_condition:'Payment condition',
  hypothetical_paid_day:'Modeled payment day'}[key]||key.replaceAll('_',' '));
export function renderPlanningUpdates(root,context){
  const {node,button,input,select,touch,render,download,status,uid}=context;
  const draft=context.getDraft(),sources=draft.planSources||[];
  if(!draft.planningReview)return false;
  const selected=selectedPlan(sources,draft.planningReview);
  const commit=(value,message)=>{context.setDraft(validateDraft(value));touch();render();if(message)status(message);};
  const update=draft.planningUpdate;
  const beforeChange=label=>retainVersion(context.getDraft(),label);
  function begin(sourceSha,revision){
    const next=beforeChange('Before reviewing incoming native plan revision '+revision);
    beginPlanningUpdate(next,sourceSha,revision,{id:uid()});
    commit(next,'Retained the current plan and answers. Review the incoming native edition and choose the complete resulting text.');
  }
  const candidates=[];
  for(const source of sources)if(source.document.id===selected.plan.id)
    for(const plan of source.document.revisions)if(source.sha256!==selected.source.sha256||plan.revision!==selected.plan.revision)
      candidates.push({source,plan});
  if(!update||update.status!=='reviewing'){
    if(update){
      const completed=node('details');
      completed.append(node('summary',update.status==='applied'?'Last reviewed plan update':'Last retained-plan decision'),
        node('p','Native revision '+update.from.revision+' → '+update.to.revision+' · '+update.finishedAt,'muted'),
        node('p',update.status==='applied'?'The selected target decisions were applied to this working submission.':'The current planning edition was retained. The incoming original file remains available.'));
      for(const row of update.outcomes||[])completed.append(node('p',row.kind+' '+row.id+' · '+row.decision));
      completed.append(button('Download complete comparison and decisions',()=>download(JSON.stringify(exportPlanningUpdate(context.getDraft()),null,2)+'\n',
        'SCF_Plan_Revision_'+update.from.revision+'_to_'+update.to.revision+'.json')));
      root.append(completed);
    }
    if(candidates.length){
      const chooser=node('details'),grid=node('div',undefined,'grid');
      chooser.append(node('summary','Review another retained revision of this native plan'),
        node('p','Compare the selected planning edition with an original saved revision before changing this submission.'));
      let index=0;
      const ordered=candidates.sort((a,b)=>b.plan.revision-a.plan.revision||b.source.receivedAt.localeCompare(a.source.receivedAt));
      grid.append(select('Incoming native planning revision',String(index),ordered.map((row,i)=>[String(i),
        row.source.filename+' · revision '+row.plan.revision+' · '+row.plan.savedAt]),value=>{index=Number(value);}).wrap,
        button('Review selected revision changes',()=>{const row=ordered[index];begin(row.source.sha256,row.plan.revision);}));
      chooser.append(grid);root.append(chooser);
    }
    return false;
  }
  const changes=planRevisionChanges(sources,update.from,update.to);
  const header=node('section',undefined,'card');header.dataset.planUpdateId=update.id;
  header.dataset.planUpdateSource=update.to.sourceSha;header.dataset.planUpdateRevision=String(update.to.revision);
  header.append(node('h2','Review incoming native plan revision'),
    node('p','Revision '+update.from.revision+' → '+update.to.revision+' of '+selected.plan.name),
    node('p','The current plan and edited submission remain available while you review the full incoming scope and resulting answers.','muted'));
  const from=selectedPlan(sources,update.from),to=selectedPlan(sources,update.to);
  const identity=node('details');identity.append(node('summary','Original files and native revision identities'));
  for(const [label,entry,ref]of [['Current selected plan',from,update.from],['Incoming plan',to,update.to]]){
    identity.append(node('h3',label),node('p',entry.source.filename+' · revision '+ref.revision+' · '+entry.plan.savedAt),
      node('p','File SHA-256 '+entry.source.sha256,'code'),node('p','Saved content SHA-256 '+entry.plan.contentSha256,'code'));
  }
  if(changes.changedSharedRevisions.length)identity.append(node('p',
    'These original files contain different content for '+changes.changedSharedRevisions.length+' identically numbered revision(s). The comparison retains both original histories; review the selected incoming content explicitly.','issues'));
  else identity.append(node('p',changes.sharedRevisions.length+' original revision identities are shared by both retained files.','muted'));
  header.append(identity);
  const controls=node('div',undefined,'row');
  controls.append(button('Refresh comparison against current draft',()=>{
    const next=beforeChange('Before refreshing the native plan revision comparison');
    refreshPlanningUpdate(next);commit(next,'Updated this comparison from the current draft. Earlier review choices remain in Saved versions.');
  }),button('Keep current plan and close review',()=>{
    const next=beforeChange('Before keeping the current native planning edition');
    finishPlanningUpdate(next,{decision:'keep-plan'});commit(next,'Kept the current planning edition and answers. The received native file remains available.');
  }),button('Download complete comparison and decisions',()=>download(JSON.stringify(exportPlanningUpdate(context.getDraft()),null,2)+'\n',
    'SCF_Plan_Revision_'+update.from.revision+'_to_'+update.to.revision+'.json')));
  header.append(controls);root.append(header);
  function table(columns,rows){
    const scroll=node('div',undefined,'plan-scroll'),value=node('table',undefined,'plan-table'),head=node('thead'),labels=node('tr'),body=node('tbody');
    for(const label of columns)labels.append(node('th',label));
    head.append(labels);value.append(head);
    for(const values of rows){const row=node('tr');for(const cell of values)row.append(node('td',pretty(cell)));body.append(row);}
    value.append(body);scroll.append(value);return scroll;
  }
  root.append(node('h3','Award, effort and delivery schedule'),table(['Value','Current native plan','Incoming native plan'],[
    ['Requested award',usd(changes.before.award)+' USD',usd(changes.after.award)+' USD'],
    ['Estimated hours',changes.before.hours,changes.after.hours],
    ['Completion day',changes.before.duration,changes.after.duration],
    ['Priced work packages',changes.before.packages,changes.after.packages],
  ]));
  root.append(node('p','All prices, hours, conditional payments and calculated cash values are read from the selected saved native revisions.','muted'));
  const packages=node('details');packages.open=true;
  const changed=changes.packages.filter(row=>row.status!=='unchanged');
  packages.append(node('summary',changed.length+' changed, added or removed work packages'));
  if(!changed.length)packages.append(node('p','The native priced work packages are identical in these revisions.'));
  for(const item of changed){
    const section=node('section',undefined,'card');section.append(node('h4',
      (item.after?.remaining_work||item.before?.remaining_work||item.id)+' · '+item.status),
      table(['Package field','Current native value','Incoming native value'],item.fields.map(row=>[title(row.key),row.before,row.after])));
    packages.append(section);
  }
  root.append(packages);
  const schedule=node('details');schedule.open=changes.tranches.some(row=>row.fields.length);
  schedule.append(node('summary','Three delivery tranches and four conditional payments'));
  for(const row of changes.tranches)schedule.append(node('h4','Tranche '+row.tranche),
    table(['Value','Current native plan','Incoming native plan'],
      ['deliverable','submit_day','amount','measurable_proof','note'].map(key=>[title(key),row.before[key],row.after[key]])));
  for(const row of changes.payments)if(row.fields.length)schedule.append(node('h4',row.tranche===0?'Initial conditional payment':'Payment after tranche '+row.tranche),
    table(['Value','Current native plan','Incoming native plan'],row.fields.map(value=>[title(value.key),value.before,value.after])));
  if(changes.payments.every(row=>!row.fields.length))schedule.append(node('p','The four conditional payments are identical in these saved revisions.','muted'));
  schedule.append(node('p','Engineering prices by tranche and conditional payment amounts retain their separate native meanings.','muted'));
  root.append(schedule);
  const calculation=node('details');calculation.append(node('summary','Original planning input, cash and capacity changes'));
  if(changes.planning.length)calculation.append(table(['Planning input','Current value','Incoming value'],changes.planning.map(row=>[title(row.key),row.before,row.after])));
  calculation.append(node('h4','Native cash calculation'),node('pre',JSON.stringify(changes.cash,null,2),'source-text'),
    node('h4','Native contributor capacity calculation'),node('pre',JSON.stringify(changes.capacity,null,2),'source-text'));
  root.append(calculation,node('h3','Choose each complete submission answer'),
    node('p','Each target shows its earlier applied plan, current edited text, incoming scope and proposed combined text. Select a full answer or edit the proposed answer to resolve overlapping changes.'));
  const targetFeedback=[],summaryIssues=node('div',undefined,'issues'),applyButton=button('Apply reviewed revision choices',()=>{
    const next=beforeChange('Before applying reviewed native plan revision '+update.to.revision);
    finishPlanningUpdate(next);commit(next,'Applied the reviewed native revision choices. The complete preceding draft, original files and review decisions remain in Saved versions and the full draft export.');
  },'primary');
  function notifyChange(){
    update.updatedAt=new Date().toISOString();touch();update.reviewedBasis='';reviewed.checked=false;refresh();
  }
  for(const row of update.targets){
    const card=node('section',undefined,'card');card.dataset.planUpdateTarget=row.key;
    card.append(node('h3',row.label),node('p',
      row.mergeStatus==='combined-edits'?'Independent native changes and editorial changes can be combined.':
      row.mergeStatus==='native-changes'?'The applied text is unchanged; the incoming native text is available.':
      row.mergeStatus==='draft-changes'?'The native scope text is unchanged; the current editorial text can be retained.':
      row.mergeStatus==='same-text'?'The compared texts already agree.':
      row.mergeStatus==='no-applied-baseline'?'This target has no retained complete applied-plan baseline. Review its current text and the incoming native scope.':
      'Native and editorial changes overlap. Edit the complete proposed answer or explicitly select one of the full texts.',
      row.mergedText===null?'issues':'muted'));
    card.append(node('p','Target basis: native revision '+row.from.revision+' · incoming revision '+update.to.revision+
      ' · '+row.costIds.length+' selected incoming work packages.','muted'));
    if(row.kind==='field'){
      const field=draft.fields.find(value=>value.id===row.id);
      if(field){
        const issuer=node('details');issuer.append(node('summary','Recorded issuer field and instructions'),
          node('p',field.label||'Field label not entered'),node('pre',field.prompt||'Issuer prompt not entered.','source-text'),
          node('p','Recorded word limit: '+(field.wordLimit??'not supplied')+' · character limit: '+(field.characterLimit??'not supplied')+
            ' · convention: '+field.characterMethod,'muted'),
          button('Open this issuer field',()=>context.showField(field.id)));
        card.append(issuer);
      }
    }
    const sourcesDetail=node('details');
    sourcesDetail.append(node('summary','Read the complete compared texts'),
      node('h4','Original generated native scope'),node('pre',row.generatedBefore,'source-text'),
      node('h4','Earlier applied answer'),node('pre',row.baseText===null?'No complete applied baseline is retained for this target.':row.baseText,'source-text'),
      node('h4','Current edited answer'),node('pre',row.inputText,'source-text'),
      node('h4','Incoming selected native scope'),node('pre',row.incomingText||'The selected native work packages were removed from this incoming revision.','source-text'));
    if(row.mergedText!==null)sourcesDetail.append(node('h4','Proposed combined answer'),node('pre',row.mergedText,'source-text'));
    if(row.conflicts?.length)sourcesDetail.append(node('h4','Overlapping edits'),node('pre',JSON.stringify(row.conflicts,null,2),'source-text'));
    card.append(sourcesDetail);
    const choices=[['','Choose complete answer'],['keep','Keep current edited answer'],['incoming','Use incoming native scope'],
      ...(row.mergedText===null?[]:[['merge','Use proposed combined answer']]),['custom','Edit and use complete proposed answer']];
    const decision=select('Revision choice for '+row.label,row.decision,choices,value=>{
      choosePlanningUpdate(draft,row.key,value);custom.wrap.hidden=value!=='custom';notifyChange();
    });
    card.append(decision.wrap);
    const custom=input('Complete proposed answer for '+row.label,row.proposalText,value=>{
      choosePlanningUpdate(draft,row.key,'custom',{text:value});decision.field.value='custom';notifyChange();
    },{area:true,className:'answer-input'});
    custom.wrap.hidden=row.decision!=='custom';card.append(custom.wrap);
    card.append(input('Revision decision note for '+row.label,row.note,value=>{
      choosePlanningUpdate(draft,row.key,row.decision,{note:value});notifyChange();
    },{area:true}).wrap);
    const after=node('details'),complete=node('pre','','source-text'),counts=node('p','','counts'),feedback=node('div',undefined,'issues');
    after.open=true;after.append(node('summary','Exact complete target after applying this choice'),counts,complete);card.append(after,feedback);
    targetFeedback.push({row,complete,counts,feedback});root.append(card);
  }
  const related=node('details');related.append(node('summary','Related requested award and capacity answers'));
  for(const row of update.context)related.append(node('h4',row.id==='project'?'Project and requested outcome':'Delivery capacity, payment timing and sustainability'),
    node('pre',row.text,'source-text'),button('Open '+(row.id==='project'?'Project':'Delivery capacity')+' answer',()=>context.showAnswer(row.id)));
  related.append(node('p','Read these current answers alongside the revised award and schedule. If you edit them, refresh the revision comparison before applying its decisions.','muted'));
  root.append(related,input('Overall native-plan revision note',update.note,value=>{update.note=value;notifyChange();},{area:true}).wrap);
  const confirmation=node('label',undefined,'check-row'),reviewed=node('input');reviewed.type='checkbox';
  reviewed.checked=update.reviewedBasis===planningUpdateReviewBasis(update);
  reviewed.addEventListener('change',()=>{
    update.reviewedBasis=reviewed.checked?planningUpdateReviewBasis(update):'';touch();refresh();
  });
  confirmation.append(reviewed,node('span','I have reviewed the exact chosen answers, native budget changes and related application context.'));
  root.append(confirmation,summaryIssues,applyButton);
  function refresh(){
    for(const item of targetFeedback){
      const text=selectedUpdateText(item.row),value=typeof text==='string'?text:'Choose the complete answer to preview it here.';
      item.complete.textContent=value;
      if(typeof text==='string'){
        const measured=measureText(outputText(text,context.format()));
        item.counts.textContent=measured.words.toLocaleString()+' whitespace-counted words · '+measured.characters.toLocaleString()+' Unicode characters';
      }else item.counts.textContent='';
      const target=(item.row.kind==='answer'?draft.answers:draft.fields).find(value=>value.id===item.row.id);
      const issues=item.row.kind==='field'&&target&&typeof text==='string'?fieldStatus({...target,text},draft.form,context.format()).issues:[];
      item.feedback.replaceChildren(...issues.map(message=>node('p',message)));item.feedback.hidden=!issues.length;
    }
    const readiness=planningUpdateReadiness(context.getDraft());
    summaryIssues.replaceChildren(...readiness.issues.map(message=>node('p',message)));summaryIssues.hidden=!readiness.issues.length;
    applyButton.disabled=readiness.issues.length>0;
  }
  refresh();return true;
}
