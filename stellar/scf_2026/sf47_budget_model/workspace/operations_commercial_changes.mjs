import {staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
const SCHEMA='sf47.commercial-change-desk.v1', enc=encodeURIComponent;
const copy=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
const human=value=>String(value||'').toLowerCase().replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());

/** Match the original Python text() contract without changing retained input. */
function commercialRequired(value,maximum){
  if(typeof value!=='string'||[...value].length>maximum||value.includes('\0'))return null;
  const normalized=value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,'');
  return normalized||null;
}

/** Resolve only the exact retained action from the authoritative saved journal. */
export function reconcileCommercialChangeAction(original,row){
  if(!original||!row||original.changeId!==row.id||!original.body||
      original.body.expectedProposalSha256!==row.proposalSha256||!Array.isArray(row.commands))return null;
  const commands=row.commands,proposal=row.proposal,actor=commercialRequired(original.body.actor,300);
  if(actor===null)return null;
  if(original.action==='apply'){
    if(actor!==proposal?.actor)return null;
    const steps=proposal.steps;
    if(!Array.isArray(steps)||!commands.length||commands.length>steps.length+1)return null;
    const applied=commands.slice(0,steps.length),later=commands.slice(steps.length);
    if(applied.some((c,i)=>c.index!==i||c.action!==steps[i].action||c.requestId!==row.id+'-step-'+(i+1))||
       later.some(c=>c.index!==steps.length||c.action!=='issue'||c.requestId!==row.id+'-issue'))return null;
    if(row.state==='APPLIED'&&applied.length===steps.length&&applied.every(c=>c.state==='ACKNOWLEDGED'))
      return {outcome:'ACKNOWLEDGED',commands:copy(commands)};
    // A partially applied replacement must continue its remaining original step.
    if(!later.length&&['PREPARED','RUNNING'].includes(row.state)&&applied.every(c=>c.state==='REJECTED'&&c.lastError?.code))
      return {outcome:'REJECTED',commands:copy(commands)};
  }
  if(original.action==='issue'){
    if(actor!==proposal?.actor||commands.some(c=>c.state==='PENDING'))return null;
    const command=commands.find(c=>c.action==='issue');
    const decision=original.body.creditDecisionId?commercialRequired(original.body.creditDecisionId,100):'';
    if(decision===null||!command||command.requestId!==row.id+'-issue'||command.body?.invoiceId!==row.activeInvoiceId||
       command.review?.issuePreviewSha256!==original.body.expectedIssuePreviewSha256||
       (command.body?.creditDecisionId||'')!==decision)return null;
    if(command.state==='ACKNOWLEDGED'||command.state==='REJECTED'&&command.lastError?.code)
      return {outcome:command.state,commands:[copy(command)]};
  }
  if(original.action==='cancel'&&row.state==='CANCELLED'&&!commands.some(c=>c.state==='PENDING')){
    const requestId=commercialRequired(original.body.requestId,100),reason=commercialRequired(original.body.reason,6000);
    if(requestId===null||reason===null)return null;
    const record=row.history?.find(h=>h.action==='cancelled'&&h.requestId===requestId&&h.actor===actor&&h.reason===reason);
    if(record)return {outcome:'ACKNOWLEDGED',commands:[],cancellation:copy(record)};
  }
  return null;
}

/** Source-backed changes remain within the original case and native account. */
export function mountCommercialChanges({container,current,billing,milestone,api,saveApi,mutationId,recordingActor,staffContext,onClose,onSources}){
  if(!document.querySelector('link[data-commercial-changes-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_commercial_changes.css';link.dataset.commercialChangesStyle='true';document.head.append(link);
  }
  const root=document.createElement('section');root.className='commercial-changes';root.setAttribute('aria-label','Milestone changes');container.append(root);
  const context=staffContext?{...staffContext}:null;
  const casePath='/api/operations/'+enc(current.program.id),path=casePath+'/commercial';
  const milestonePath=path+'/'+enc(billing.id)+'/milestones/'+enc(milestone.milestoneId)+'/changes';
  const key=staffDeskStorageKey('sf47.commercial-changes.'+current.program.id+'.'+billing.id+'.'+milestone.milestoneId,context);
  let session={inputs:{},selected:null,pending:null,lastRequest:null};
  try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved?.inputs)session=saved;}catch{}
  const state={current,items:[],row:null,review:null,reviewInput:null,issue:null,busy:false,error:false,message:'',head:null};
  let active=true,hostBusy=false;
  const visible=()=>active&&root.isConnected;
  const input=(name,fallback='')=>session.inputs[name]??fallback;
  const selectedPath=id=>path+'/changes/'+enc(id);
  const button=(label,action,disabled=false)=>'<button type="button" data-change-action="'+action+'"'+(disabled?' data-fixed="true" disabled':'')+'>'+esc(label)+'</button>';
  function persist(critical=false){
    try{const raw=JSON.stringify(session);sessionStorage.setItem(key,raw);if(sessionStorage.getItem(key)!==raw)throw Error('The complete original action could not be retained.');}
    catch(error){if(critical)throw Error('Download the complete change desk before continuing: '+error.message);}
  }
  function capture(){root.querySelectorAll('[name]').forEach(e=>{session.inputs[e.name]=e.multiple?[...e.selectedOptions].map(x=>x.value):e.value;});persist();}
  function body(){return {expectedVersion:state.current.program.version,previousChangeId:state.head,actor:recordingActor(),
    sourceIds:input('sourceIds',[]),mode:input('mode','DRAFT_EDIT'),resolution:input('resolution','CREDIT'),
    targetAmount:input('targetAmount',milestone.amount),issueDate:input('issueDate',milestone.issueDate||day()),
    dueDate:input('dueDate',milestone.dueDate||day()),effectiveDate:input('effectiveDate',day()),
    authorizedOn:input('authorizedOn',day()),description:input('description',milestone.label),
    reason:input('reason'),authorization:input('authorization'),purchaseOrder:input('purchaseOrder',billing.purchaseOrder||''),note:input('note',billing.note||'')};}
  function field(name,label,fallback='',{type='text',options,multiple=false,area=false,required=false}={}){
    const value=input(name,fallback),attrs=' name="'+esc(name)+'"'+(required?' required':'');
    let control;
    if(options){const values=Array.isArray(value)?value:[String(value)];control='<select'+attrs+(multiple?' multiple size="5"':'')+'>'+options.map(([id,title])=>'<option value="'+esc(id)+'"'+(values.includes(id)?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';}
    else if(area)control='<textarea'+attrs+' rows="3">'+esc(value)+'</textarea>';
    else control='<input'+attrs+' type="'+type+'" value="'+esc(value)+'">';
    return '<label><span>'+esc(label)+'</span>'+control+'</label>';
  }
  function busy(){root.setAttribute('aria-busy',String(state.busy||hostBusy));root.querySelectorAll('button,input,select,textarea').forEach(e=>{
    const recovery=['resume','download-desk','download-request','close','refresh'].includes(e.dataset.changeAction);
    e.disabled=state.busy||hostBusy||e.dataset.fixed==='true'||Boolean(session.pending&&!recovery);
  });}
  async function run(fn){if(!visible()||state.busy||hostBusy)return;capture();state.busy=true;state.error=false;state.message='';busy();try{await fn();}catch(e){state.error=true;state.message=e.message||String(e);}finally{state.busy=false;persist();if(visible())render();}}
  function validateAction(op){
    if(!op||typeof op!=='object'||!op.body||typeof op.body!=='object')throw Error('Retain the complete original customer action.');
    const expected=op.action==='prepare'?milestonePath+'/prepare':
      ['apply','cancel','issue'].includes(op.action)&&typeof op.changeId==='string'?selectedPath(op.changeId)+'/'+op.action:null;
    if(!expected||op.endpoint!==expected)throw Error('This action belongs to another customer or milestone.');
    assertStaffRequestActor(op.body,context);return op;
  }
  function reconcilePending(row){
    const original=session.pending,resolution=reconcileCommercialChangeAction(original,row);
    if(!resolution)return false;
    validateAction(original);
    const entry={...copy(original),resolution:{...resolution,changeId:row.id,proposalSha256:row.proposalSha256,receivedAt:new Date().toISOString()}};
    const before=session;
    session={...copy(session),pending:null,lastRequest:entry,resolvedActions:[...(session.resolvedActions||[]),entry]};
    try{persist(true);}catch(error){session=before;throw error;}
    state.issue=null;state.review=null;
    return true;
  }
  async function sendOriginal(op=null){
    if(op){if(session.pending)throw Error('Resume the original retained action first.');validateAction(op);session.pending={...copy(op),createdAt:new Date().toISOString()};}
    const original=validateAction(session.pending);persist(true);
    try{
      const result=await saveApi(original.endpoint,copy(original.body));
      session.lastRequest={...copy(original),result:{id:result.id,state:result.state,proposalSha256:result.proposalSha256},receivedAt:new Date().toISOString()};
      session.pending=null;session.selected=result.id;state.row=result;state.review=null;state.issue=null;persist();await refresh(result.id);return result;
    }catch(e){
      original.error={message:e.message||String(e),code:e.code||null,status:e.status||null};
      // Native mutation errors can follow an uncertain committed request. Keep the
      // exact request until its server journal supplies the original outcome.
      if(original.action==='prepare'&&[400,409,413,415,422].includes(e.status)&&e.code!=='REQUEST_CONFLICT'){
        session.lastRequest=copy(original);session.pending=null;
      }
      persist();
      if(original.changeId){try{reconcilePending(await api(selectedPath(original.changeId)));}catch(recoveryError){
        original.recoveryError={message:recoveryError.message||String(recoveryError)};persist();
      }}
      throw e;
    }
  }
  async function refresh(wanted=session.selected){
    const [program,listing]=await Promise.all([api(casePath),api(milestonePath)]);
    state.current=program;state.items=listing.items;state.head=listing.previousChangeId;
    const found=state.items.find(x=>x.id===wanted)||state.items.at(-1);
    session.selected=found?.id||null;state.row=found?await api(selectedPath(found.id)):null;
    if(session.pending?.changeId){
      const journal=state.row?.id===session.pending.changeId?state.row:await api(selectedPath(session.pending.changeId));
      reconcilePending(journal);
    }
    if(state.row){const fresh=await saveApi(selectedPath(state.row.id)+'/refresh',{});state.row=fresh;}
  }
  function snapshot(){return {schema:SCHEMA,caseId:current.program.id,preparedId:billing.id,milestoneId:milestone.milestoneId,session:copy(session)};}
  function downloadDesk(){capture();download(new Blob([JSON.stringify(snapshot(),null,2)+'\n'],{type:'application/json'}),milestone.milestoneId+'-change-desk.json');}
  async function openDesk(file){
    if(!file)return;if(file.size>8*1024*1024)throw Error('Open a complete change desk within 8 MiB.');
    const value=JSON.parse(await file.text());
    if(value.schema!==SCHEMA||value.caseId!==current.program.id||value.preparedId!==billing.id||value.milestoneId!==milestone.milestoneId||!value.session?.inputs)throw Error('Open this case and milestone’s original change desk.');
    if(session.pending)throw Error('Receive the current original action before opening another desk.');
    if(value.session.pending)validateAction(value.session.pending);
    downloadDesk();session=copy(value.session);state.review=null;state.issue=null;persist(true);await refresh();state.message='Opened the retained source fields and original customer action.';
  }
  function money(value,currency=billing.schedule.currency){return esc(value??'—')+' '+esc(currency?.code||'');}
  function proposalView(proposal,heading){
    const invoice=proposal.nativeBefore.invoice;
    return '<section class="change-card"><h3>'+esc(heading)+'</h3><dl class="change-facts">'+
      '<div><dt>Native invoice</dt><dd>'+esc(invoice.number||invoice.id)+'</dd></div>'+
      '<div><dt>Original amount</dt><dd>'+money(proposal.nativeBefore.draft.totals.total)+'</dd></div>'+
      '<div><dt>Paid</dt><dd>'+money(invoice.paid)+'</dd></div>'+
      '<div><dt>Already credited</dt><dd>'+money(invoice.credited)+'</dd></div>'+
      '<div><dt>Authorized revised amount</dt><dd>'+money(proposal.targetAmount)+'</dd></div>'+
      '<div><dt>Accounting date</dt><dd>'+esc(proposal.effectiveDate)+'</dd></div></dl>'+
      '<h4>Customer authorization</h4><p>'+esc(proposal.authorization)+'</p><p>'+esc(proposal.reason)+'</p>'+
      '<ul>'+proposal.authorizationSources.map(s=>'<li>'+esc(s.metadata.filename||s.id)+' · '+esc(s.metadata.bytes)+' bytes · <code>'+esc(s.metadata.sha256)+'</code></li>').join('')+'</ul>'+
      '<h4>Reviewed native actions</h4><ol>'+proposal.steps.map(s=>'<li><strong>'+esc(human(s.action))+'</strong> '+
      esc(s.action==='credit'?s.body.lines.map(x=>x.netAmount+' net / '+x.taxAmount+' tax').join(', '):
        s.action==='draft'?proposal.targetAmount+' '+proposal.currency.code+' · '+proposal.issueDate+' → '+proposal.dueDate:
        'Original invoice effective '+s.body.voidDate)+'</li>').join('')+'</ol>'+
      '<p>'+esc(proposal.consequences.paymentDisposition)+'</p><p>'+esc(proposal.consequences.replacementIssue)+'</p></section>';
  }
  function nativeView(){
    if(!state.row?.currentNative)return '';
    return '<section class="change-card"><h3>Current native account</h3>'+state.row.currentNative.map(d=>'<article><h4>'+esc(d.invoice.number||d.invoice.id)+'</h4>'+
      '<dl class="change-facts"><div><dt>Status</dt><dd>'+esc(human(d.invoice.paymentStatus||d.invoice.status))+'</dd></div>'+
      '<div><dt>Amount due</dt><dd>'+money(d.invoice.amountDue,d.invoice.currency)+'</dd></div>'+
      '<div><dt>Paid</dt><dd>'+money(d.invoice.paid,d.invoice.currency)+'</dd></div>'+
      '<div><dt>Credited</dt><dd>'+money(d.invoice.credited,d.invoice.currency)+'</dd></div>'+
      '<div><dt>Credit balance</dt><dd>'+money(d.invoice.creditBalance,d.invoice.currency)+'</dd></div></dl></article>').join('')+'</section>';
  }
  function retainedView(){
    const row=state.row;if(!row)return '';
    const unfinished=row.state==='PREPARED'||row.state==='RUNNING';
    return proposalView(row.proposal,'Saved change · '+human(row.state))+
      '<section class="change-card"><h3>Original accounting commands</h3>'+
      (row.commands.length?'<div class="change-table"><table><thead><tr><th>Action</th><th>State</th><th>Original request</th><th>Result</th></tr></thead><tbody>'+
      row.commands.map(c=>'<tr><td>'+esc(human(c.action))+'</td><td>'+esc(human(c.state))+'</td><td><code>'+esc(c.requestId)+'</code></td><td>'+
        esc(c.result?.invoice?.number||c.result?.operation?.result?.creditId||c.lastError?.message||'Awaiting original result')+'</td></tr>').join('')+
      '</tbody></table></div>':'<p>The reviewed preparation has no accounting command yet.</p>')+
      (row.commands.some(c=>c.action==='issue'&&c.state==='REJECTED')?
        '<p>The native invoice issue was declined before commit. Its original request and review remain in this history. Resume the same request when its unchanged terms are valid, or prepare a new source-backed draft correction below to review a different credit decision or revised terms.</p>':'')+
      '<div class="change-actions">'+button('Apply or recover reviewed change','apply',!unfinished)+
      button('Review changed invoice','preview-issue',row.state!=='APPLIED'||!row.proposal.steps.some(s=>s.action==='draft'))+
      button('Refresh native records','refresh')+button('Export complete change and account','export')+'</div>'+
      (unfinished&&row.commands.every(c=>c.state==='REJECTED')?'<details><summary>Cancel an unused preparation</summary><p>Keep its original source and cancelled history, then prepare a fresh review.</p>'+
      field('cancelReason','Reason for cancellation','',{required:true,area:true})+button('Cancel unused preparation','cancel')+'</details>':'')+'</section>'+nativeView();
  }
  function issueView(){
    const review=state.issue;if(!review)return '';const d=review.nativePreview.document;
    return '<section class="change-card"><h3>Issue review</h3><dl class="change-facts"><div><dt>Customer</dt><dd>'+esc(d.customer?.name)+'</dd></div>'+
      '<div><dt>Invoice date</dt><dd>'+esc(d.issueDate)+'</dd></div><div><dt>Due date</dt><dd>'+esc(d.dueDate)+'</dd></div>'+
      '<div><dt>Total</dt><dd>'+money(d.totals.total,d.currency)+'</dd></div></dl>'+
      '<p>'+esc(d.lines.map(l=>l.description+' · '+l.quantity+' × '+l.unitAmount).join('\n'))+'</p>'+
      '<p>'+esc(review.eligibility?.ready?'Original milestone billing prerequisites are satisfied.':review.eligibility?.message||'Complete the original milestone acceptance before issue.')+'</p>'+
      (review.retainedCommand?
        '<p>This continuation uses the original invoice review and retained credit decision. To use a different decision, prepare a new source-backed draft correction.</p>'+
        '<dl class="change-facts"><div><dt>Retained native credit decision</dt><dd>'+esc(review.retainedCommand.body.creditDecisionId||'No decision was selected for this original request.')+'</dd></div></dl>':
        '<p>'+esc(review.nativePreview.creditReviewRequired?'Native credit review is required. Select its current approved decision.':'')+'</p>'+
        field('creditDecisionId','Existing native credit decision, when required',review.nativePreview.creditDecisionId||''))+
      '<div class="change-actions">'+button(review.retainedCommand?'Resume original invoice issue':'Confirm and issue reviewed invoice','issue',!review.retainedCommand&&!review.eligibility?.ready)+button('Close issue review','close-issue')+'</div></section>';
  }
  function render(){
    if(!visible())return;
    const sources=(state.current.sources||[]).map(x=>[x.id,x.filename||x.id]);
    root.innerHTML='<header class="change-heading"><div><h2>Milestone changes</h2><p>'+esc(milestone.label)+' · original '+money(milestone.amount)+'</p></div>'+button('Back to customer billing','close')+'</header>'+
      '<p class="change-message" role="'+(state.error?'alert':'status')+'" aria-live="polite">'+esc(state.message)+'</p>'+
      '<section class="change-card"><h3>Continue this customer case</h3><div class="change-actions">'+button('Download complete desk','download-desk')+
      button('Open complete desk','open-desk')+button('Open case sources','sources')+
      (session.pending||session.lastRequest?button('Download original action','download-request'):'')+'</div><input data-change-desk-file type="file" accept=".json,application/json" hidden>'+
      (session.pending?'<p>'+esc(session.pending.error?.message||'The original customer action is retained. Receive its result before another action.')+'</p>'+button('Resume original action','resume'):'')+
      (state.items.length?'<label><span>Change history</span><select data-change-history>'+state.items.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===session.selected?' selected':'')+'>'+
        esc('Change '+x.sequence+' · '+human(x.state)+' · '+human(x.mode||x.proposal?.mode))+'</option>').join('')+'</select></label>':'<p>No milestone change has been prepared.</p>')+'</section>'+
      retainedView()+issueView()+
      '<section class="change-card"><h3>Review a customer amendment</h3><p>Select the original customer authorization already retained in this case. The original Workshare remains attached to the billing history.</p>'+
      '<form data-change-form><div class="change-grid">'+
      field('mode','Change','DRAFT_EDIT',{options:[['DRAFT_EDIT','Correct an unissued draft'],['CREDIT','Reduce an issued amount by credit'],['VOID','Void an unpaid invoice'],['REPLACE','Replace an issued invoice']]} )+
      field('resolution','Original invoice treatment for replacement','CREDIT',{options:[['CREDIT','Credit the remaining original amount'],['VOID','Void the unpaid original invoice']]})+
      field('targetAmount','Authorized revised milestone amount',milestone.amount,{required:true})+
      field('description','Revised invoice line',milestone.label,{required:true})+
      field('issueDate','Invoice date',milestone.issueDate||day(),{type:'date',required:true})+
      field('dueDate','Due date',milestone.dueDate||day(),{type:'date',required:true})+
      field('effectiveDate','Credit or void accounting date',day(),{type:'date',required:true})+
      field('authorizedOn','Customer authorization date',day(),{type:'date',required:true})+
      field('purchaseOrder','Purchase order',billing.purchaseOrder||'')+'</div>'+
      field('sourceIds','Original authorization files',[],{options:sources,multiple:true,required:true})+
      field('reason','Reason for the change','',{area:true,required:true})+
      field('authorization','Customer authorization and interpretation','',{area:true,required:true})+
      field('note','Invoice note',billing.note||'',{area:true})+
      '<button type="submit">Review native effects</button></form></section>'+
      (state.review?proposalView(state.review.proposal,'Review before preparation')+'<div class="change-actions">'+button('Save reviewed customer change','prepare')+button('Close review','close-review')+'</div>':'');
    busy();
  }
  root.addEventListener('input',()=>{capture();state.review=null;state.reviewInput=null;});
  root.addEventListener('change',e=>{
    if(e.target.matches('[data-change-desk-file]')){const file=e.target.files?.[0];e.target.value='';run(()=>openDesk(file));return;}
    if(e.target.matches('[data-change-history]')){run(async()=>{session.selected=e.target.value;state.issue=null;await refresh();});return;}
    capture();state.review=null;state.reviewInput=null;
  });
  root.addEventListener('submit',e=>{if(!e.target.matches('[data-change-form]'))return;e.preventDefault();if(!e.target.reportValidity())return;
    run(async()=>{state.current=await api(casePath);const value=body();state.review=await saveApi(milestonePath+'/preview',value);state.reviewInput=copy(value);state.message='Review the source files, revised amount and native actions before saving.';});
  });
  root.addEventListener('click',e=>{
    const target=e.target.closest('[data-change-action]');if(!target||target.disabled)return;const action=target.dataset.changeAction;
    if(action==='close'){capture();onClose();return;}
    if(action==='download-desk'){downloadDesk();return;}
    if(action==='download-request'){download(new Blob([JSON.stringify(session.pending||session.lastRequest,null,2)+'\n'],{type:'application/json'}),'milestone-original-action.json');return;}
    if(action==='open-desk'){root.querySelector('[data-change-desk-file]').click();return;}
    if(action==='sources'){capture();onSources?.();return;}
    run(async()=>{
      if(action==='resume'){await sendOriginal();state.message='Received the same original customer action.';return;}
      if(action==='close-review'){state.review=null;return;}
      if(action==='close-issue'){state.issue=null;return;}
      if(action==='refresh'){await refresh();state.message='Read the original invoices and retained change history.';return;}
      if(action==='prepare'){
        if(!state.review||!state.reviewInput)throw Error('Review the current customer amendment first.');
        const value={...copy(state.reviewInput),expectedPreviewSha256:state.review.previewSha256};
        value.requestId=await mutationId('commercial-change:'+current.program.id+':prepare',value);
        await sendOriginal({action:'prepare',endpoint:milestonePath+'/prepare',body:value});state.message='Saved the reviewed amendment and exact native action plan.';return;
      }
      const row=state.row;if(!row)throw Error('Open a saved customer change.');
      if(action==='export'){const response=await api(selectedPath(row.id)+'/export.zip',undefined,{download:true});download(await response.blob(),row.id+'.zip');state.message='Exported the original commercial source, complete change chain and native documents.';return;}
      if(action==='preview-issue'){state.issue=await saveApi(selectedPath(row.id)+'/preview-issue',{});return;}
      const value={actor:recordingActor(),expectedProposalSha256:row.proposalSha256};
      if(action==='cancel'){value.reason=input('cancelReason');value.requestId=await mutationId('commercial-change:'+row.id+':cancel',value);}
      if(action==='issue'){if(!state.issue)throw Error('Review the changed native invoice first.');value.expectedIssuePreviewSha256=state.issue.issuePreviewSha256;
        const decision=state.issue.retainedCommand?state.issue.retainedCommand.body.creditDecisionId:input('creditDecisionId');
        if(decision)value.creditDecisionId=decision;}
      if(!['apply','cancel','issue'].includes(action))throw Error('Choose a current customer action.');
      await sendOriginal({action,changeId:row.id,endpoint:selectedPath(row.id)+'/'+action,body:value});
      state.message=action==='issue'?'Received the original native invoice issue.':action==='cancel'?'Retained the cancelled preparation and its source.':'Received the reviewed native correction commands.';
    });
  });
  render();const ready=run(()=>refresh());
  return {ready,setHostBusy(value){hostBusy=Boolean(value);if(visible())busy();},dispose(){capture();active=false;root.remove();}};
}
