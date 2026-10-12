// Payment-based completion operations in the original SF47 case.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const utcDate=()=>new Date().toISOString().slice(0,10);
const clone=value=>structuredClone(value);
const button=(text,action,attrs='',disabled=false)=>'<button type="button" data-completion-action="'+action+'" '+attrs+(disabled?' disabled data-completion-fixed="true"':'')+'>'+esc(text)+'</button>';
const table=(heads,rows)=>'<div class="completion-table"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const note=text=>'<p class="completion-note">'+esc(text)+'</p>';
function field(title,key,value='',options={}){
  const attrs=' name="'+esc(key)+'"'+(options.required?' required':'')+(options.attrs?' '+options.attrs:'');
  let input;
  if(options.options)input='<select'+attrs+(options.multiple?' multiple size="3"':'')+'>'+options.options.map(([id,name,disabled])=>'<option value="'+esc(id)+'"'+((options.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+(disabled?' disabled':'')+'>'+esc(name)+'</option>').join('')+'</select>';
  else if(options.area)input='<textarea'+attrs+' rows="'+(options.rows||3)+'"'+(options.max?' maxlength="'+options.max+'"':'')+'>'+esc(value)+'</textarea>';
  else input='<input'+attrs+' type="'+(options.type||'text')+'" value="'+esc(value)+'"'+(options.max?' maxlength="'+options.max+'"':'')+'>';
  return '<label class="'+(options.wide?'completion-wide':'')+'">'+esc(title)+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function saveDownload(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function values(select){return [...select.selectedOptions].map(row=>row.value);}
function definite(error){return [400,401,403,404,409,413,422].includes(error?.status)&&typeof error?.code==='string';}

export function mountCompletion({container,current,saveApi,session,mutationId,recordingActor,onCase}){
  const root=document.createElement('section');root.className='completion-desk';root.setAttribute('aria-label','Tranche completion');container.replaceChildren(root);
  if(!document.querySelector('link[data-completion-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_completion.css';link.dataset.completionStyle='true';document.head.append(link);
  }
  for(const [key,value] of Object.entries({tranche:1,asOfDate:utcDate(),drafts:{},formDrafts:{},receiptId:'',summary:'',cohortReviewIds:[],preview:null,reviewId:'',review:null,pending:null,accepted:null,inflight:null,dialog:null,notice:'',error:''})){
    if(!Object.hasOwn(session,key))session[key]=value;
  }
  let active=true,hostBusy=false,busy=false,caseValue=current,calendar=current.completion;
  const available=()=>active&&root.isConnected;
  const editable=()=>caseValue.program.state==='OPEN'&&!hostBusy&&!busy&&!session.pending&&!session.inflight&&!session.accepted;
  const $=selector=>root.querySelector(selector);
  const draft=()=>session.drafts[String(session.tranche)];
  const sourceOptions=()=>caseValue.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,10)]);
  const identity=id=>(caseValue.records.contributors.find(row=>row.id===id)?.name||id);
  const prefix='/api/operations/'+current.program.id;
  const savedPlan=tranche=>caseValue.completionPlans?.find(row=>row.tranche===tranche);
  function clearPreview(){session.preview=null;}
  function error(error){session.error=error.message||String(error);if(available())render();}
  function updateControls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(hostBusy||busy||!!session.inflight));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      const retry=el.dataset.completionAction==='retry',readback=el.dataset.completionAction==='readback';
      el.disabled=el.dataset.completionFixed==='true'||hostBusy||busy||!!session.inflight||
        (!!session.pending&&!retry)||(!!session.accepted&&!readback)||
        ((el.dataset.completionWrite==='true'||el.closest('[data-completion-dialog]')&&el.tagName!=='BUTTON')&&caseValue.program.state!=='OPEN');
    }
  }
  async function run(fn){
    if(!available()||hostBusy||busy||session.inflight)return;
    busy=true;session.error='';updateControls();
    try{return await fn();}catch(cause){error(cause);}finally{busy=false;if(available())render();}
  }
  function captureCurrent(next){
    if(next.program.id!==current.program.id)throw new Error('The returned completion case changed identity.');
    caseValue=next;
    for(const [number,value] of Object.entries(session.drafts)){
      const saved=next.completionPlans?.find(row=>row.tranche===Number(number));
      if(!value.dirty&&saved){value.inputs=clone(saved.inputs);value.baseVersion=next.program.version;}
    }
    if(session.preview?.source.version!==next.program.version)session.preview=null;
    calendar=next.completion;
  }
  async function reloadCase(){
    const next=await saveApi(prefix);captureCurrent(next);
    if(session.asOfDate!==next.completion.asOfDate)calendar=await saveApi(prefix+'/completion?asOfDate='+encodeURIComponent(session.asOfDate));
    return next;
  }
  async function loadDraft(tranche){
    const key=String(tranche),existing=session.drafts[key];
    if(existing)return existing;
    const seeded=await saveApi(prefix+'/completion-seed',{expectedVersion:caseValue.program.version,tranche});
    const created={inputs:seeded.inputs,baseVersion:caseValue.program.version,dirty:false};
    session.drafts[key]=created;return created;
  }
  function reconcileAccepted(next){
    const accepted=session.accepted;if(!accepted)return;
    const {payload,result}=accepted;
    if(next.program.id!==result.id||next.program.version<result.version)return;
    let superseded=false;
    if(payload.action==='completion.save'){
      const number=payload.data.inputs.tranche,saved=next.completionPlans?.find(row=>row.tranche===number);
      if(!saved||saved.id!==result.recordId||!result.unchanged&&saved.version<result.version)return;
      superseded=saved.version>result.version;
      session.drafts[String(number)]={inputs:clone(saved.inputs),baseVersion:next.program.version,dirty:false};
    }else if(payload.action==='completion.prepare'){
      if(!next.reviews.some(row=>row.id===result.recordId))return;
      session.reviewId=result.recordId;session.review=null;
    }else if(payload.action==='completion.extension'){
      if(!next.completionPlans.some(row=>row.extensions.some(item=>item.id===result.extensionId)))return;
    }else if(!next.records.outcomes.some(row=>row.id===result.recordId))return;
    session.accepted=null;session.dialog=null;
    session.notice=payload.action==='completion.prepare'?'Prepared the complete original tranche form and selected sources.':
      payload.action==='completion.submit'?'Retained the actual form submission with its original preparation and payment deadline.':
      payload.action==='completion.extension'?'Retained the issuer confirmation; the original deadline remains visible.':
      payload.action==='completion.decision'?'Retained the issuer outcome on the original form submission.':
      superseded?'Your assignments were saved. The current case also contains a later recorded assignment change.':
      result.unchanged?'Reopened the original saved assignments.':'Saved the complete tranche assignments in this case.';
  }
  async function sendPending(){
    const retained=session.pending;if(!retained)return;
    if(session.inflight){await session.inflight;return;}
    const work=(async()=>{
      try{
        const result=await saveApi(prefix+'/command',retained.payload);
        session.accepted={payload:retained.payload,result};session.pending=null;
        session.error='';return result;
      }catch(cause){
        if(definite(cause)){
          session.pending=null;session.rejected={payload:retained.payload,code:cause.code};
          session.notice='The request was rejected. Your assignments and entered form fields are retained for review.';
        }
        session.error=cause.message||String(cause);throw cause;
      }
    })();
    session.inflight=work;updateControls();
    let result;
    try{result=await work;}
    finally{if(session.inflight===work)session.inflight=null;}
    const next=await reloadCase();reconcileAccepted(next);
    if(available())await onCase(next,result);
    return result;
  }
  async function mutate(action,data,expectedVersion=caseValue.program.version){
    if(!available()||hostBusy||session.pending||session.inflight||session.accepted||caseValue.program.state!=='OPEN')return;
    const payload={expectedVersion,actor:recordingActor(),action,data:clone(data),note:''};
    payload.requestId=await mutationId('operations:'+action,payload);
    session.pending={payload};session.error='';$('dialog.completion-dialog')?.close();
    try{return await sendPending();}
    catch(cause){
      if(definite(cause)){
        const next=await reloadCase();session.rejected=null;
        if(available())await onCase(next,null);
      }
      throw cause;
    }
  }
  async function openReview(id){
    if(!id){session.review=null;session.reviewId='';return;}
    const review=await saveApi(prefix+'/reviews/'+id);
    if(review.purpose!=='TRANCHE_COMPLETION')throw new Error('Select an original tranche completion preparation.');
    session.reviewId=id;session.review=review;
  }
  async function selectTranche(number){
    session.formDrafts[String(session.tranche)]={receiptId:session.receiptId,summary:session.summary,cohortReviewIds:clone(session.cohortReviewIds),
      preview:session.preview,reviewId:session.reviewId,review:session.review};
    session.tranche=number;
    Object.assign(session,{cohortReviewIds:[]},session.formDrafts[String(number)]||{receiptId:'',summary:'',preview:null,reviewId:'',review:null});
    if(session.preview?.source.version!==caseValue.program.version)session.preview=null;
    await loadDraft(number);chooseReceipt();
  }
  function chooseReceipt(){
    if(session.receiptId)return;
    session.receiptId=calendar.clocks.find(row=>row.tranche===session.tranche&&row.active)?.receiptId||'';
  }
  function clockTable(){
    if(!calendar.clocks.length)return note('Record a received grant payment in Cash / issuer to begin a completion clock. Assignment planning is available now.');
    return table(['Previous payment','Completion','Original deadline','Confirmed deadline','Form state',''],calendar.clocks.map(row=>[
      'T'+row.paymentTranche+' · '+esc(row.paidOn)+'<small>'+esc(row.paymentReference)+'</small>',
      'T'+row.tranche,
      esc(row.originalDeadlineOn),
      row.extension?esc(row.deadlineOn)+'<small>'+esc(row.extension.reference)+'</small>':'—',
      esc(label(row.status))+(row.active?'<small>'+row.daysRemaining+' calendar days remaining</small>':''),
      button('Use this payment','receipt','data-receipt="'+esc(row.receiptId)+'"')+
        button('Record issuer extension','extension','data-receipt="'+esc(row.receiptId)+'" data-completion-write="true"',!row.active||caseValue.program.state!=='OPEN'),
    ]));
  }
  function itemFields(item,original){
    const attrs=key=>'data-completion-field="'+key+'" data-cost="'+esc(item.costId)+'" data-completion-write="true"';
    const work=caseValue.records.work.filter(row=>row.costId===item.costId).map(row=>[row.id,row.description+' · '+row.state]);
    const deployments=caseValue.records.deployments.filter(row=>(row.tranche===null||row.tranche===session.tranche)&&(!row.costIds.length||row.costIds.includes(item.costId))).map(row=>[row.id,row.name+' · '+row.state]);
    return '<details class="completion-item" data-completion-item="'+esc(item.costId)+'" open><summary><strong>'+esc(item.costId)+'</strong> · '+esc(label(item.state))+'</summary>'+
      '<p>'+esc(original.remainingWork)+'</p><p><strong>Success criteria:</strong> '+esc(original.successCriteria)+'</p>'+
      '<p class="completion-small">Original award days '+original.awardStartDay+'–'+original.awardEndDay+
      (original.awardStartDate?' · '+esc(original.awardStartDate)+' to '+esc(original.awardEndDate):'')+
      ' · '+esc(original.plannedHours)+' planned hours · $'+esc(original.plannedUsd)+'</p>'+
      (original.planningAssignments.length?'<p class="completion-small">Planning allocation: '+original.planningAssignments.map(row=>esc(row.name)+' '+esc(row.hours)+' h').join(', ')+'</p>':'')+
      '<div class="completion-fields">'+
      field('Assigned contributors','owners_'+item.costId,item.ownerIds,{options:caseValue.records.contributors.map(row=>[row.id,row.name]),multiple:true,attrs:attrs('ownerIds'),wide:true})+
      field('Assigned start','start_'+item.costId,item.startDate,{type:'date',attrs:attrs('startDate')})+
      field('Assigned finish','finish_'+item.costId,item.endDate,{type:'date',attrs:attrs('endDate')})+
      field('Delivery state','state_'+item.costId,item.state,{options:['PLANNED','IN_PROGRESS','COMPLETE'].map(x=>[x,label(x)]),attrs:attrs('state')})+
      field('Actual completion date','completed_'+item.costId,item.completedOn,{type:'date',attrs:attrs('completedOn')})+
      field('Actual completed result','result_'+item.costId,item.completionNote,{area:true,wide:true,attrs:attrs('completionNote')})+
      field('Original work records','work_'+item.costId,item.workIds,{options:work,multiple:true,attrs:attrs('workIds')})+
      field('Original deployments','deployments_'+item.costId,item.deploymentIds,{options:deployments,multiple:true,attrs:attrs('deploymentIds')})+
      field('Retained deliverable sources','sources_'+item.costId,item.sourceIds,{options:sourceOptions(),multiple:true,wide:true,attrs:attrs('sourceIds')})+
      field('Assignment note','note_'+item.costId,item.note,{area:true,wide:true,attrs:attrs('note')})+
      '</div></details>';
  }
  function assignments(){
    const value=draft(),row=calendar.tranches.find(x=>x.tranche===session.tranche);
    if(!value)return note('Opening the original work-package assignments…');
    const stale=value.baseVersion!==caseValue.program.version;
    const packages=new Map(row.packages.map(x=>[x.costId,x]));
    return '<section><div class="completion-heading"><h3>Tranche '+session.tranche+' deliverables</h3><div class="completion-actions">'+
      button('Save assignments','save','data-completion-write="true"',caseValue.program.state!=='OPEN'||stale)+
      button('Open saved assignments','reset')+'</div></div>'+
      '<p>'+esc(row.deliverable)+'</p><p class="completion-small">Award-relative submission: day '+row.awardSubmitDay+(row.awardSubmitDate?' · '+esc(row.awardSubmitDate):'')+'</p>'+
      '<p class="completion-note" data-completion-draft-status>'+esc(value.dirty?'Unsaved assignment changes':'Original assignment source version '+value.baseVersion)+'</p>'+
      (stale?'<div class="completion-note"><p>The case is now version '+caseValue.program.version+'. Review the saved source alongside your retained draft.</p>'+
        button('Keep draft against current case','rebase','data-completion-write="true"',caseValue.program.state!=='OPEN')+'</div>':'')+
      value.inputs.items.map(item=>itemFields(item,packages.get(item.costId))).join('')+
      field('Completion plan note','completionPlanNote',value.inputs.note,{area:true,wide:true,attrs:'data-completion-plan-note data-completion-write="true"'})+
      '</section>';
  }
  function cohortSelection(){
    const selected=session.cohortReviewIds;
    const rows=caseValue.reviews.filter(row=>row.purpose==='COHORT_EVALUATION'&&(row.cohortTranche===session.tranche||selected.includes(row.id)));
    const options=rows.map(row=>[row.id,'T'+row.cohortTranche+' · '+(row.cohortName||row.id)+' · '+(row.cohortReady?'targets met':'findings retained')+(row.cohortSourceCurrent===false?' · source changed':'')]);
    for(const id of selected)if(!rows.some(row=>row.id===id))options.push([id,id+' · original review unavailable']);
    return field('Frozen cohort evidence (optional)','completionCohorts',selected,{options,multiple:true,wide:true,
      help:'Select reviews prepared in Cohort acceptance. The completion preview checks their original tranche, cutoff, targets and measurement source. Selection does not assert issuer acceptance.'});
  }
  function cohortEvidence(candidate){
    const rows=candidate?.cohortEvidence||[];if(!rows.length)return '';
    return '<section class="completion-cohorts"><h4>Frozen cohort evidence</h4>'+
      table(['Review','Purchase window / cutoff','At preparation',''],rows.map(row=>{
        const value=row.review.cohort,inputs=value.inputs;
        return [esc(inputs.name)+'<small>'+esc(row.reviewId)+'</small>',
          esc(inputs.windowStart||'Unentered')+' – '+esc(inputs.windowEnd||'Unentered')+'<small>'+esc(inputs.asOfAt)+'</small>',
          (row.ready?'Targets met':'Findings retained')+'<small>'+(row.sourceCurrent?'Measurement source current':'Measurement source changed')+'</small>',
          button('Download cohort evidence','download-cohort','data-review="'+esc(row.reviewId)+'"')];
      }))+'</section>';
  }
  function preparation(){
    const options=calendar.clocks.filter(row=>row.tranche===session.tranche).map(row=>[row.receiptId,'T'+row.paymentTranche+' payment '+row.paidOn+' · due '+row.deadlineOn+' · '+row.paymentReference,!row.active]);
    const value=draft(),preview=session.preview;
    return '<section><h3>Prepare the completion form</h3><div class="completion-fields">'+
      field('Previous payment','completionReceipt',session.receiptId,{options:[['','Choose the actual previous payment'],...options],wide:true})+
      field('Completed tranche result','completionSummary',session.summary,{area:true,rows:5,wide:true,max:20000,attrs:'data-completion-write="true"'})+
      cohortSelection()+
      '</div><div class="completion-actions">'+button('Preview completion','preview','',!session.receiptId||!!value?.dirty)+
      button('Prepare completion','prepare','data-completion-write="true"',!preview?.ready||preview?.source.version!==caseValue.program.version||caseValue.program.state!=='OPEN')+'</div>'+
      (value?.dirty?note('Save the edited assignments before preparing their form.'): '')+
      (preview?'<div class="completion-preview" data-completion-preview><h4>'+ (preview.ready?'Ready to prepare':'Complete the remaining fields')+
        '</h4><p>Previous payment '+esc(preview.receipt.date)+' · form deadline '+esc(preview.clock.deadlineOn)+'</p>'+
        (preview.issues.length?'<ul>'+preview.issues.map(item=>'<li>'+esc(item.costId?item.costId+': ':'')+esc(item.message)+'</li>').join('')+'</ul>':'')+
        '<p>'+esc(preview.summary)+'</p>'+cohortEvidence(preview)+'<small>Reviewed case version '+preview.source.version+'</small></div>':'')+'</section>';
  }
  function preparations(){
    const reviews=caseValue.reviews.filter(row=>row.purpose==='TRANCHE_COMPLETION'&&row.completionTranche===session.tranche);
    const review=session.review,candidate=review?.completion;
    return '<section><h3>Saved form preparations</h3>'+
      (reviews.length?field('Prepared completion','completionReview',session.reviewId,{options:[['','Choose an original preparation'],...reviews.map(row=>[row.id,row.createdAt+' · T'+row.completionTranche+' · '+row.id])],wide:true}):note('Prepared forms appear here with their complete frozen source.'))+
      (candidate?'<div class="completion-preview" data-completion-review="'+esc(review.id)+'"><h4>Tranche '+candidate.clock.tranche+' preparation</h4>'+
        '<p>'+esc(candidate.summary)+'</p><p>Paid '+esc(candidate.receipt.date)+' · reviewed deadline '+esc(candidate.clock.deadlineOn)+'</p>'+
        table(['Work package','Owners','Completed','Result'],candidate.completionPlan.inputs.items.map(item=>[
          esc(item.costId),item.ownerIds.map(id=>esc(candidate.completionPlan?review.snapshot.records.contributors.find(row=>row.id===id)?.name||id:id)).join(', '),
          esc(item.completedOn),esc(item.completionNote)]))+cohortEvidence(candidate)+
        '<div class="completion-actions">'+button('Download prepared files','download-review')+
        button('Record form submission','submission','data-completion-write="true"',caseValue.program.state!=='OPEN')+'</div></div>':'')+
      '</section>';
  }
  function submissions(){
    const rows=caseValue.records.outcomes.filter(row=>row.completion&&row.tranche===session.tranche);
    return '<section><h3>Actual form submissions and issuer outcomes</h3>'+
      (rows.length?table(['Form reference','Submitted','Deadline used','Current issuer outcome',''],rows.map(row=>[
        esc(row.completion.formReference),esc(row.completion.submittedOn),
        esc(row.completion.deadlineOn)+'<small>'+ (row.completion.submittedOn<=row.completion.deadlineOn?'Submitted within deadline':'Submitted after deadline')+'</small>',
        esc(label(row.state))+'<small>'+esc(row.date)+'</small>',
        button('Open preparation','review','data-review="'+esc(row.completion.reviewId)+'"')+
        button('Record issuer outcome','decision','data-outcome="'+esc(row.id)+'" data-completion-write="true"',caseValue.program.state!=='OPEN'),
      ])):note('Use the original completion form receipt to record its submission. Each receipt keeps the exact prepared source.'))+'</section>';
  }
  function dialogMarkup(){
    const selected=session.dialog;if(!selected||session.pending||session.inflight||session.accepted)return '';
    const v=selected.data;
    let fields='',title='';
    if(selected.action==='completion.extension'){
      title='Record issuer-confirmed extension';
      fields=note('Original previous payment '+v.receiptId)+
        field('Issuer confirmation date','confirmedOn',v.confirmedOn,{type:'date',required:true})+
        field('Confirmed submission deadline','deadlineOn',v.deadlineOn,{type:'date',required:true})+
        field('Original confirmation reference','reference',v.reference,{wide:true,required:true})+
        field('Issuer confirmation note','note',v.note,{area:true,wide:true})+
        field('Retained confirmation sources','sourceIds',v.sourceIds,{multiple:true,options:sourceOptions(),wide:true});
    }else if(selected.action==='completion.submit'){
      title='Record actual form submission';
      fields=field('Actual form submission date','submittedOn',v.submittedOn,{type:'date',required:true})+
        field('Original form receipt reference','formReference',v.formReference,{required:true,wide:true})+
        field('Original form source / observation','sourceNote',v.sourceNote,{area:true,wide:true})+
        field('Retained form receipt sources','sourceIds',v.sourceIds,{multiple:true,options:sourceOptions(),wide:true});
    }else{
      title='Record issuer outcome';
      fields=field('Issuer outcome','state',v.state,{options:['ACCEPTED','CHANGES_REQUESTED','WITHDRAWN'].map(x=>[x,label(x)])})+
        field('Actual outcome date','date',v.date,{type:'date',required:true})+
        field('Original issuer reference and outcome','sourceNote',v.sourceNote,{area:true,wide:true,required:true})+
        field('Retained issuer sources','sourceIds',v.sourceIds,{multiple:true,options:sourceOptions(),wide:true});
    }
    return '<dialog class="completion-dialog" aria-labelledby="completion-dialog-title"><form data-completion-dialog>'+
      '<h3 id="completion-dialog-title">'+title+'</h3><div class="completion-fields">'+fields+'</div>'+
      '<p role="alert">'+esc(session.error)+'</p><div class="completion-actions">'+button('Keep draft and close','close-dialog')+
      '<button type="submit" data-completion-write="true">Save original record</button></div></form></dialog>';
  }
  function render(){
    if(!available())return;
    const pending=session.pending;
    root.innerHTML='<div class="completion-heading"><div><h2>Tranche completion</h2><p>Assignments, received payments, prepared forms and actual submissions in this case.</p></div>'+
      '<a href="'+esc(calendar.rule.sourceUrl)+'" target="_blank" rel="noopener noreferrer">SCF tranche guidelines</a></div>'+
      '<p class="completion-small">Each T0, T1 or T2 payment starts the following tranche form’s 90-calendar-day clock. The original award schedule stays alongside it. Issuer outcomes below show their current recorded state; the calendar date selects payment and form dates.</p>'+
      '<div class="completion-fields">'+field('Completion tranche','completionTranche',session.tranche,{options:[[1,'Tranche 1'],[2,'Tranche 2'],[3,'Tranche 3']]})+
      field('Calendar date','completionAsOfDate',session.asOfDate,{type:'date',help:caseValue.program.mode==='WALKTHROUGH'?'Illustrative dates remain in this walkthrough.':'Current UTC date by default.'})+'</div>'+
      '<p data-completion-message role="'+(session.error?'alert':'status')+'" aria-live="polite">'+esc(session.error||session.notice)+'</p>'+
      (pending?'<div class="completion-note"><p>Retained request '+esc(pending.payload.requestId)+' awaits its original result.</p>'+button('Retry same save','retry')+'</div>':'')+
      (session.accepted?'<div class="completion-note"><p>The write returned its receipt.</p>'+button('Reopen accepted result','readback')+'</div>':'')+
      (session.closedDialog&&!session.dialog?button('Resume form draft','resume-dialog'):'')+
      '<section><h3>Payment clocks</h3>'+clockTable()+
      (calendar.unassignedGrantIds.length?note('These received grant payments need their original tranche selection. Use the original cash correction to void an incorrect receipt and record its corrected source: '+calendar.unassignedGrantIds.join(', ')):'')+
      (calendar.finalPaymentIds.length?note('Final T3 payments retained: '+calendar.finalPaymentIds.join(', ')):'')+'</section>'+
      assignments()+preparation()+preparations()+submissions()+dialogMarkup();
    const dialog=$('dialog.completion-dialog');if(dialog&&!dialog.open)dialog.showModal();
    updateControls();
  }
  root.addEventListener('input',event=>{
    if(!editable())return;
    const el=event.target;
    if(el.matches('[data-completion-field]')){
      const value=draft(),item=value.inputs.items.find(row=>row.costId===el.dataset.cost),key=el.dataset.completionField;
      item[key]=el.multiple?values(el):el.type==='date'?(el.value||null):el.value;value.dirty=true;clearPreview();
    }else if(el.matches('[data-completion-plan-note]')){draft().inputs.note=el.value;draft().dirty=true;clearPreview();}
    else if(el.name==='completionSummary'){session.summary=el.value;clearPreview();}
    else if(el.closest('[data-completion-dialog]'))session.dialog.data[el.name]=el.multiple?values(el):el.value;
    const status=$('[data-completion-draft-status]');if(status&&draft()?.dirty)status.textContent='Unsaved assignment changes';
    const previewButton=$('[data-completion-action=preview]');if(previewButton){previewButton.dataset.completionFixed=String(!session.receiptId||!!draft()?.dirty);previewButton.disabled=previewButton.dataset.completionFixed==='true';}
    const preview=$('[data-completion-preview]');if(preview&&!session.preview)preview.remove();
    const prepare=root.querySelector('[data-completion-action=prepare]');if(prepare&&!session.preview){prepare.disabled=true;prepare.dataset.completionFixed='true';}
  });
  root.addEventListener('change',event=>{
    const el=event.target;
    if(el.closest('[data-completion-dialog]')&&editable())session.dialog.data[el.name]=el.multiple?values(el):el.value;
    if(el.name==='completionTranche')run(async()=>{if(session.pending||session.accepted)return;await selectTranche(Number(el.value));});
    if(el.name==='completionAsOfDate')run(async()=>{if(session.pending)return;session.asOfDate=el.value;calendar=await saveApi(prefix+'/completion?asOfDate='+encodeURIComponent(el.value));clearPreview();chooseReceipt();});
    if(el.name==='completionReceipt'){if(session.pending||busy||hostBusy)return;session.receiptId=el.value;clearPreview();render();}
    if(el.name==='completionCohorts'){if(session.pending||busy||hostBusy)return;session.cohortReviewIds=values(el);clearPreview();render();}
    if(el.name==='completionReview')run(async()=>openReview(el.value));
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-completion-action]');if(!target||target.disabled)return;
    const action=target.dataset.completionAction;
    run(async()=>{
      if(action==='retry'){
        await sendPending();return;
      }
      if(action==='readback'){const next=await reloadCase();reconcileAccepted(next);if(available())await onCase(next,session.accepted?.result||null);return;}
      if(session.pending||session.accepted)return;
      if(action==='resume-dialog'){session.dialog=session.closedDialog;session.closedDialog=null;return;}
      if(action==='save'){
        const value=draft();
        if(value.baseVersion!==caseValue.program.version)throw new Error('Review the current case before saving your retained draft.');
        await mutate('completion.save',{inputs:value.inputs},value.baseVersion);return;
      }
      if(action==='reset'){delete session.drafts[String(session.tranche)];await loadDraft(session.tranche);clearPreview();return;}
      if(action==='rebase'){
        const next=await reloadCase();draft().baseVersion=next.program.version;session.notice='Retained draft now targets the current case version.';clearPreview();if(available())await onCase(next,null);return;
      }
      if(action==='receipt'){
        const clock=calendar.clocks.find(row=>row.receiptId===target.dataset.receipt);
        if(clock.tranche!==session.tranche)await selectTranche(clock.tranche);
        session.receiptId=clock.receiptId;clearPreview();return;
      }
      if(action==='preview'){
        if(draft()?.dirty)throw new Error('Save the edited assignments before preparing their completion.');
        session.preview=await saveApi(prefix+'/completion-preview',{expectedVersion:caseValue.program.version,receiptId:session.receiptId,asOfDate:session.asOfDate,summary:session.summary,...(session.cohortReviewIds.length?{cohortReviewIds:clone(session.cohortReviewIds)}:{})});return;
      }
      if(action==='prepare'){
        const preview=session.preview;if(!preview?.ready||preview.source.version!==caseValue.program.version)throw new Error('Preview the complete current source before preparing.');
        await mutate('completion.prepare',{receiptId:session.receiptId,asOfDate:session.asOfDate,summary:session.summary,expectedPreviewSha256:preview.previewSha256,...(session.cohortReviewIds.length?{cohortReviewIds:clone(session.cohortReviewIds)}:{})});return;
      }
      if(action==='review'){await openReview(target.dataset.review);return;}
      if(action==='download-cohort'){
        const id=target.dataset.review,response=await saveApi(prefix+'/cohort-reviews/'+encodeURIComponent(id)+'/export.zip',undefined,{download:true});
        const blob=await response.blob();if(available())saveDownload(blob,id+'-cohort.zip');return;
      }
      if(action==='download-review'){
        const response=await saveApi(prefix+'/completion-reviews/'+session.reviewId+'/export.zip',undefined,{download:true});
        const blob=await response.blob();if(available())saveDownload(blob,session.reviewId+'-completion.zip');return;
      }
      if(action==='extension'){
        session.dialog={action:'completion.extension',data:{receiptId:target.dataset.receipt,confirmedOn:session.asOfDate,deadlineOn:'',reference:'',sourceIds:[],note:''}};return;
      }
      if(action==='submission'){
        if(!session.review)throw new Error('Open the original prepared form first.');
        session.dialog={action:'completion.submit',data:{reviewId:session.review.id,expectedReviewSha256:session.review.businessSha256,submittedOn:session.asOfDate,formReference:'',sourceIds:[],sourceNote:''}};return;
      }
      if(action==='decision'){
        session.dialog={action:'completion.decision',data:{outcomeId:target.dataset.outcome,state:'ACCEPTED',date:session.asOfDate,sourceIds:[],sourceNote:''}};return;
      }
      if(action==='close-dialog'){$('dialog.completion-dialog')?.close();session.closedDialog=session.dialog;session.dialog=null;return;}
    });
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-completion-dialog]'))return;event.preventDefault();
    const selected=session.dialog;
    run(async()=>{if(!selected||session.pending)return;await mutate(selected.action,selected.data);});
  });
  root.addEventListener('cancel',event=>{
    if(event.target.matches('dialog.completion-dialog')){event.preventDefault();if(!session.pending&&!session.inflight){session.closedDialog=session.dialog;session.dialog=null;render();}}
  },true);
  render();
  const ready=(async()=>{
    if(session.inflight){try{await session.inflight;}catch{}}
    if(session.accepted||session.rejected){const next=await reloadCase();reconcileAccepted(next);session.rejected=null;}
    else if(session.asOfDate!==calendar.asOfDate)calendar=await saveApi(prefix+'/completion?asOfDate='+encodeURIComponent(session.asOfDate));
    await loadDraft(session.tranche);chooseReceipt();
    if(session.reviewId)await openReview(session.reviewId);
    render();
  })();
  return {ready,root,setHostBusy(value){hostBusy=!!value;updateControls();},
    dispose(){active=false;$('dialog.completion-dialog')?.close();}};
}
