// MIT. Required-content review in the original saved submission editor.
import {requirementReviewInput,requirementReviewStatus,requirementCoverage} from './grant-requirement-review-core.mjs';
export function renderRequirementReviews(root,context){
  const {node,button,input,select,link,touch,render,status,getDraft,setDraft,ANSWERS,REQUIREMENTS,OFFICIAL,
    recordReview,showAnswer,showField,download}=context;
  const draft=getDraft(),criteria={url:OFFICIAL.criteria,reviewedAt:OFFICIAL.reviewedAt};
  root.append(node('h2','Required content'),node('p','Review the complete text the issuer will read. Record who reviewed each requirement, the supporting answers or actual form fields, and the decision. Later changes remain visible.'));
  const references=node('div',undefined,'row');
  references.append(link('Submission criteria',OFFICIAL.criteria),link('Budget guidance',OFFICIAL.budget),link('Official rules',OFFICIAL.rules));
  root.append(references,node('p','Criteria source reviewed '+OFFICIAL.reviewedAt+'. These are editorial decisions. The selected text and notes do not establish issuer approval.','muted'));
  const summary=node('section',undefined,'card');
  summary.append(node('h3','Review the intended output'));
  const coverageLines=[];
  const updateCoverage=()=>{for(const [kind,line]of coverageLines){const coverage=requirementCoverage(getDraft(),{outputKind:kind,criteria});line.textContent=(kind==='answers'?'Canonical answers':'Issuer form fields')+': '+(coverage.reviews.length-coverage.attention.length)+' of '+coverage.reviews.length+' requirements have a current recorded decision for that output. '+coverage.attention.length+' need attention.';}};
  for(const kind of ['answers','fields']){
    const line=node('p');line.dataset.requiredContentCoverage=kind;coverageLines.push([kind,line]);summary.append(line);
    summary.append(button('Download complete '+(kind==='answers'?'answer':'issuer-field')+' review',()=>{
      download(JSON.stringify(requirementCoverage(getDraft(),{outputKind:kind,criteria}),null,2)+'\n',
        'scf-required-content-'+kind+'.json');
      status('Downloaded the complete editorial decisions, reviewed text and current comparisons.');
    }));
  }
  updateCoverage();root.append(summary);
  for(const rule of REQUIREMENTS){
    const review=draft.reviews.find(row=>row.id===rule.id),observed=requirementReviewStatus(draft,rule.id,{criteria});
    const card=node('section',undefined,'card');card.dataset.requirementId=rule.id;card.dataset.reviewBasisState=observed.status;
    card.append(node('h3',rule.title),node('p',rule.detail));
    const state=node('p',observed.status==='unbound'?'Needs first review of exact text':
      observed.status==='changed'?'Reviewed text or context changed — review again':'Recorded review matches the selected text','issues');
    state.setAttribute('role','status');card.append(state);
    card.append(node('p','Recorded decision: '+review.status+(observed.actor?' · '+observed.actor+' · '+observed.reviewedAt:''),'muted'));
    if(observed.status==='unbound')card.append(node('p','The existing status and note remain historical. No exact text basis was recorded, so they have not been attached to the current wording.'));
    const pendingLine=node('p','An unfinished review decision is retained. Record it explicitly when ready.','muted');
    pendingLine.hidden=!observed.pending;pendingLine.setAttribute('role','status');card.append(pendingLine);
    let discardButton=null;
    const updatePending=()=>{const pending=!!review.contentReviewDraft;pendingLine.hidden=!pending;card.dataset.reviewPending=String(pending);if(discardButton)discardButton.hidden=!pending;updateCoverage();};
    const compare=node('details');compare.append(node('summary','Read complete reviewed and current text'));
    if(!observed.basis)compare.append(node('p','No previous text-bound review is available.'),node('pre',review.note,'source-text'));
    for(const row of observed.rows){
      const label=row.kind==='field'?(row.after?.label||row.before?.label||row.id):(ANSWERS.find(item=>item[0]===row.id)?.[1]||row.id);
      const section=node('section');section.append(node('h4',label+' · '+row.kind+' · '+row.status));
      section.append(node('h5','At the recorded review'),node('pre',row.before?JSON.stringify(row.before,null,2):'(not selected)','source-text'),
        node('h5','Current draft'),node('pre',row.after?JSON.stringify(row.after,null,2):'(removed)','source-text'));
      compare.append(section);
    }
    for(const change of observed.changes)compare.append(node('h4',change.kind+' changed'),
      node('h5','At the recorded review'),node('pre',JSON.stringify(change.before,null,2),'source-text'),
      node('h5','Current draft'),node('pre',JSON.stringify(change.after,null,2),'source-text'));
    if(observed.basis){const full=node('details');full.append(node('summary','Complete original basis'),node('pre',JSON.stringify(observed.basis,null,2),'source-text'));compare.append(full);}
    card.append(compare);
    const initial=requirementReviewInput(review);
    const change=(key,value)=>{review.contentReviewDraft={...requirementReviewInput(review),[key]:value};touch('Review changes are retained as unfinished work; record the decision when ready.');updatePending();};
    card.append(input('Reviewer name',initial.actor,value=>change('actor',value)).wrap,
      select('Decision to record',initial.status,[['unreviewed','Choose a decision'],['covered','Covered in selected text'],['needs-edit','Needs editing'],['not-applicable','Not applicable — explain why']],value=>change('status',value)).wrap,
      input('Supporting location and decision reason',initial.note,value=>change('note',value),{area:true}).wrap);
    const choices=node('details');choices.open=true;choices.append(node('summary','Select complete text reviewed'));
    choices.append(node('p','Select actual issuer fields to review field output. Selecting only canonical answers does not review the fields. Linked source-answer changes also require a new review of a selected field.','muted'));
    const choose=(key,id,checked)=>{
      const selected=requirementReviewInput(review)[key];
      change(key,checked?[...selected,id]:selected.filter(value=>value!==id));render();
    };
    for(const [kind,rows,key]of [
      ['answer',draft.answers,'answerIds'],['field',draft.fields,'fieldIds'],
    ]){
      choices.append(node('h4',kind==='answer'?'Canonical answers':'Actual issuer fields'));
      if(!rows.length)choices.append(node('p','No issuer fields have been recorded.'));
      for(const item of rows){
        const label=kind==='answer'?(ANSWERS.find(row=>row[0]===item.id)?.[1]||item.id):(item.label||'Unlabeled field');
        const line=node('div',undefined,'row'),wrap=node('label',undefined,'check-row'),check=node('input');
        check.type='checkbox';check.checked=initial[key].includes(item.id);check.dataset.reviewTextId=kind+':'+item.id;
        check.addEventListener('change',()=>choose(key,item.id,check.checked));
        wrap.append(check,node('span',label));line.append(wrap,button('Open '+label,()=>kind==='answer'?showAnswer(item.id):showField(item.id)));choices.append(line);
        if(check.checked){
          const detail=node('details');detail.append(node('summary','Complete current '+label));
          if(kind==='field')detail.append(node('p',item.prompt),node('p','Source answers: '+item.answerIds.join(', '),'muted'));
          detail.append(node('pre',item.text,'source-text'));choices.append(detail);
        }
      }
      for(const id of initial[key].filter(id=>!rows.some(row=>row.id===id))){
        choices.append(node('p','Selected '+kind+' was removed: '+id,'issues'),
          button('Remove missing selection '+id,()=>choose(key,id,false)));
      }
    }
    card.append(choices);
    const controls=node('div',undefined,'row');
    controls.append(button('Record review of this exact text',()=>{
      const current=getDraft(),selected=current.reviews.find(row=>row.id===rule.id);
      setDraft(recordReview(current,rule.id,requirementReviewInput(selected)));touch();render();
      status('Recorded the named review and complete text basis. The preceding decision and draft remain in Saved versions.');
    },'primary'));
    discardButton=button('Discard unfinished review edits',()=>{
      const next=context.retainVersion(getDraft(),'Before discarding unfinished requirement review');
      delete next.reviews.find(row=>row.id===rule.id).contentReviewDraft;setDraft(next);touch();render();
    });controls.append(discardButton);updatePending();
    card.append(controls,node('p','Recording keeps the current answer and field wording. It saves an editorial decision and retains the preceding full draft version.','muted'));
    root.append(card);
  }
}
