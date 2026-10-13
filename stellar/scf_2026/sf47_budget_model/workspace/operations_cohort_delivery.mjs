import {
  COHORT_DELIVERY_COMPARISON_SCHEMA, COHORT_DELIVERY_INPUT_SCHEMA,
  seedCohortDeliveryComparison, compareCohortDelivery, reopenCohortDeliveryComparison,
  exportCohortDeliveryCsv, exportCohortDeliveryHtml, seedCohortCommercialChoices, inspectCohortOriginalCosts, selectCohortOriginalCosts
} from './cohort_delivery_comparison.mjs';

const SESSION='stellar-forge.sf47-cohort-delivery-session.v1', sessions=new Map(), MAX=8*1024*1024;
const copy=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const fixed=value=>value===null||value===undefined?'—':String(value);
const clean=value=>String(value||'cohort-delivery').replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,100);
const btn=(title,action,attrs='',disabled=false)=>'<button type="button" data-cd-action="'+action+'" '+attrs+(disabled?' disabled data-cd-fixed="true"':'')+'>'+esc(title)+'</button>';
const table=(headers,rows)=>'<div class="cd-table"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const detail=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
function choices(rows,selected,empty='Select…'){return '<option value="">'+esc(empty)+'</option>'+rows.map(([id,name])=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(name)+'</option>').join('');}
function stamp(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.valueOf())?value:new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(date)+' UTC';}
function download(raw,name,type='application/json'){const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type:type+';charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function base64(raw){const bytes=new TextEncoder().encode(raw);let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
function decoded(raw){const bytes=Uint8Array.from(atob(raw),char=>char.charCodeAt(0));return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
const definitive=error=>[400,409,413,422].includes(error?.status)&&typeof error?.code==='string';

export function mountCohortDelivery({container,current,saveApi,getActor,mutationId,inform=()=>{},onCaseUpdated=()=>{}}) {
  const caseId=current.program.id,prefix='/api/operations/'+encodeURIComponent(caseId),storageKey='sf47.cohort-delivery.'+caseId;
  const root=document.createElement('section');root.className='cohort-delivery';root.setAttribute('aria-label','Cohort delivery comparison');container.replaceChildren(root);
  let active=true,hostBusy=false,caseValue=current;
  if(!document.querySelector('link[data-cohort-delivery-style]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/operations_cohort_delivery.css';css.dataset.cohortDeliveryStyle='true';document.head.append(css);}
  if(!sessions.has(caseId)){
    let restored;try{restored=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    const initial={schema:SESSION,caseId,input:null,report:null,pending:null,accepted:null,rejected:null,savedSourceId:null,
      selectedPlan:'',selectedReview:'',selectedSource:'',tab:'report',page:0,search:'',filter:'all',editIntent:null,notice:'',error:'',inflight:null};
    if(restored?.schema===SESSION&&restored.caseId===caseId)Object.assign(initial,restored,{report:null,inflight:null});
    sessions.set(caseId,initial);
  }
  const state=sessions.get(caseId),available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  if(!Array.isArray(state.parkedComparisons))state.parkedComparisons=[];
  const pending=()=>!!(state.pending||state.accepted),locked=()=>hostBusy||!!state.inflight;
  function persist(required=false){
    const {report,inflight,...retained}=state;
    try{sessionStorage.setItem(storageKey,JSON.stringify(retained));}
    catch(error){if(required)throw new Error('The complete pending comparison could not be retained in this browser. Download its JSON, free browser session space, and reopen this case before saving.');state.storageNotice='The current comparison is retained in this open tab. Download JSON to keep a copy across browser restart.';}
  }
  function controls(){if(!available())return;root.querySelectorAll('button,input,select,textarea').forEach(node=>{node.disabled=locked()||node.dataset.cdFixed==='true';});}
  async function run(task){
    if(locked())return;
    state.error='';
    const promise=(async()=>{try{await task();}catch(error){state.error=error.message||String(error);}})();
    state.inflight=promise;controls();
    try{await promise;}finally{if(state.inflight===promise)state.inflight=null;persist();if(available())render();}
  }
  const repairable=error=>['COMMERCIAL_ORIGINAL_SOURCE_CHANGED','COMMERCIAL_ORIGINAL_PERIOD','COMMERCIAL_ORIGINAL_QUANTITY','COMMERCIAL_ORIGINAL_VALUATION',
    'COMMERCIAL_COST_SOURCE_CHANGED','COMMERCIAL_ALLOCATION_CONFLICT','COMMERCIAL_REFUND_SOURCE_CHANGED','COMMERCIAL_CLOCK_CONFLICT',
    'DUPLICATE_IDENTITY_LINK','UNKNOWN_IDENTITY_LINK','UNKNOWN_INTENT_ASSIGNMENT','INTENT_IDENTITY_CONFLICT'].includes(error?.code);
  function recalculate(candidate=state.input){
    if(!candidate){state.report=null;return;}
    try{
      const report=compareCohortDelivery(candidate);state.input=report.input;state.report=report;state.repair=null;
    }catch(error){
      if(!repairable(error))throw error;
      seedCohortDeliveryComparison(candidate.planDocument,candidate.review);
      state.input=copy(candidate);state.report=null;state.repair={code:error.code,message:error.message,path:error.path||''};
      state.tab='commercial';state.error=error.message;
    }
    state.savedSourceId=null;state.page=0;
  }
  function requireEditable(){if(pending())throw new Error('Finish the retained save request before changing this comparison.');}
  async function readSource(meta){
    const response=await saveApi(prefix+'/sources/'+encodeURIComponent(meta.id),undefined,{download:true}),bytes=await response.arrayBuffer();
    if(bytes.byteLength>MAX)throw new Error('Select a complete source within the original 8 MiB attachment bound.');
    if(Number.isInteger(meta.bytes)&&bytes.byteLength!==meta.bytes)throw new Error('The downloaded source differs from its original byte count.');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(meta.sha256&&hash!==meta.sha256)throw new Error('The downloaded source differs from its original source hash.');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  async function refresh(){
    const next=await saveApi(prefix);
    if(next?.program?.id!==caseId)throw new Error('The selected source belongs to another Operations case.');
    caseValue=next;
    return next;
  }
  async function finishAccepted(){
    const accepted=state.accepted;if(!accepted)return;
    const next=await refresh(),result=accepted.result;
    if(result.id!==caseId||next.program.version<result.version)throw new Error('The accepted comparison has not appeared in its original case readback.');
    const meta=next.sources.find(row=>row.id===result.recordId);
    if(!meta)throw new Error('The accepted comparison source is not yet listed in the case.');
    const raw=await readSource(meta),expected=decoded(accepted.payload.data.contentBase64);
    if(raw!==expected||meta.filename!==accepted.payload.data.filename)throw new Error('The reopened source differs from the complete original save request.');
    const report=reopenCohortDeliveryComparison(JSON.parse(raw));
    state.input=report.input;state.report=report;state.savedSourceId=meta.id;state.selectedSource=meta.id;
    state.accepted=null;state.notice='Saved and reopened '+meta.filename+' in the original case history.';
    try{persist(true);}catch(error){state.accepted=accepted;throw error;}
    if(available()){await onCaseUpdated(next,result);if(available())inform('Saved the complete delivery comparison and both original source documents.');}
  }
  async function sendPending(){
    if(state.accepted)return finishAccepted();
    if(!state.pending)return;
    const retained=state.pending;persist(true);
    try{
      const result=await saveApi(prefix+'/command',retained.payload);
      state.accepted={...retained,result};state.pending=null;persist(true);
    }catch(error){
      if(definitive(error)){state.rejected={...retained,code:error.code,rejectedAt:new Date().toISOString()};state.pending=null;persist();}
      throw error;
    }
    await finishAccepted();
  }
  async function save(){
    if(pending())return sendPending();
    if(!state.input)throw new Error('Select a saved adoption plan and an original cohort review first.');
    const actor=String((await getActor())??'').trim();if(!actor)throw new Error('Enter the recording operator in Operations.');
    await refresh();if(caseValue.program.state!=='OPEN')throw new Error('Open this original Operations case before attaching a comparison edition.');
    const createdAt=new Date().toISOString(),editionId='cohort-delivery-'+crypto.randomUUID();
    const next=copy(state.input);next.recording={...next.recording,actor,createdAt,editionId};
    const report=compareCohortDelivery(next),raw=JSON.stringify(report,null,2)+'\n';
    if(new TextEncoder().encode(raw).length>MAX)throw new Error('This complete comparison exceeds one 8 MiB source attachment. Download the complete JSON and retain it with the original case export.');
    const payload={expectedVersion:caseValue.program.version,actor,action:'source.add',
      data:{kind:'other',filename:'sf47-cohort-delivery-'+editionId+'.json',contentBase64:base64(raw),mediaType:'application/json',sourceUrl:'',observedAt:createdAt},
      note:'Cohort delivery comparison: '+next.title};
    payload.requestId=await mutationId('operations:'+caseId,payload);
    state.input=next;state.report=report;state.pending={payload};persist(true);await sendPending();
  }
  function parkComparison(incoming){
    const commercialDrafts=state.commercialDrafts||{},hasForms=Object.keys(commercialDrafts).length>0;
    if(!state.input||state.savedSourceId&&!hasForms||JSON.stringify(state.input)===JSON.stringify(incoming)&&!hasForms)return;
    const raw=JSON.stringify({input:state.input,commercialDrafts});
    if(state.parkedComparisons.some(row=>JSON.stringify({input:row.input,commercialDrafts:row.commercialDrafts||{}})===raw))return;
    state.parkedComparisons.push({id:'navigation-'+crypto.randomUUID(),input:copy(state.input),
      commercialDrafts:copy(commercialDrafts),editIntent:state.editIntent,tab:state.tab,
      savedSourceId:state.savedSourceId,selectedPlan:state.selectedPlan,selectedReview:state.selectedReview,
      retainedAt:new Date().toISOString()});
  }
  function parkedComparisons(){
    if(!state.parkedComparisons.length)return '';
    return '<section class="cd-panel"><h3>Retained comparison drafts</h3><p>Opening an original saved edition keeps the comparison and commercial fields you were editing here.</p>'+
      table(['Comparison','Retained','Continue'],state.parkedComparisons.map(row=>[
        esc(row.input.title),esc(stamp(row.retainedAt)),
        btn('Resume draft','resume-parked','data-id="'+esc(row.id)+'"',pending())+
        btn('Download draft JSON','download-parked','data-id="'+esc(row.id)+'"')
      ]))+'</section>';
  }
  function openDocument(document,preserveDraft=false){
    requireEditable();
    const retained=document.schema===SESSION?document:null;
    if(retained){
      if(retained.caseId!==caseId||!retained.input)throw new Error('Open this complete comparison draft in its original case.');
      document=retained.input;
    }
    const candidate=document.schema===COHORT_DELIVERY_COMPARISON_SCHEMA?reopenCohortDeliveryComparison(document).input:
      document.schema===COHORT_DELIVERY_INPUT_SCHEMA?document:null;
    if(!candidate)throw new Error('Open complete delivery comparison JSON or its editable source input.');
    if(candidate.review?.snapshot?.program?.id!==caseId)throw new Error('Open the original Operations case for this comparison.');
    if(preserveDraft||retained)parkComparison(candidate);
    recalculate(candidate);state.selectedReview=state.input.review.id;
    if(preserveDraft||retained){state.commercialDrafts=copy(retained?.commercialDrafts||{});state.editIntent=retained?.editIntent||null;}
    if(retained){state.selectedPlan=retained.selectedPlan||'';state.selectedReview=retained.selectedReview||state.input.review.id;}

  }
  function pager(rows){
    const pages=Math.max(1,Math.ceil(rows.length/40));state.page=Math.max(0,Math.min(state.page,pages-1));
    return {rows:rows.slice(state.page*40,(state.page+1)*40),html:'<div class="cd-pagination">'+btn('Previous','previous','',state.page===0)+'<span>Page '+(state.page+1)+' of '+pages+' · '+rows.length+' rows</span>'+btn('Next','next','',state.page+1>=pages)+'</div>'};
  }
  function overview(){
    const r=state.report;if(!r)return '<p class="cd-empty">Choose a saved adoption plan and a frozen cohort review, then open the comparison.</p>';
    const s=r.summary;
    let rows=r.rows.filter(row=>state.filter==='all'||state.filter==='due'&&row.remainingDue>0||state.filter==='late'&&row.lateAfterPlan>0||state.filter==='adjusted'&&(row.refunded||row.cancelledAfterSettlement));
    if(state.search.trim()){const q=state.search.toLowerCase();rows=rows.filter(row=>[row.id,row.label,row.buyerId,row.operationId,...row.intentIds].join(' ').toLowerCase().includes(q));}
    const page=pager(rows);
    return '<div class="cd-metrics">'+[['Planned paid purchases',s.plannedPaidPurchases],['Recorded cohort completions',s.observedComplete],['Independent completions',s.observedIndependentComplete],['Due remaining',s.remainingDue],['Unmatched intents',s.unmatchedIntents],['Delivered after planned time',s.lateAfterPlan]].map(([k,v])=>'<div><span>'+esc(k)+'</span><strong>'+v+'</strong></div>').join('')+'</div>'+
      '<p>'+s.plannedUsefulTasks+' useful tasks are retained in the adoption plan. Purchase, request and task-use units keep their original meanings. The cohort review supplies the recorded completion classifications.</p>'+
      '<div class="cd-tools"><label>Search opportunities<input data-cd-field="search" value="'+esc(state.search)+'" placeholder="Customer, operation or original identity"></label><label>Show<select data-cd-field="filter">'+[['all','All opportunities'],['due','Due with remaining work'],['late','Delivered late'],['adjusted','Refunded or canceled']].map(([id,name])=>'<option value="'+id+'"'+(state.filter===id?' selected':'')+'>'+name+'</option>').join('')+'</select></label></div>'+
      table(['Opportunity','UTC date','Planned completions','Recorded / independent','Due remaining','Late','State'],page.rows.map(row=>[
        '<strong>'+esc(row.label)+'</strong><small>'+esc(row.id)+'</small>',esc(row.date),row.plannedCompletePurchases,row.observedComplete+' / '+row.observedIndependentComplete,row.remainingDue,row.lateAfterPlan,esc(label(row.state))
      ]))+page.html+
      '<h3>Original proposed targets</h3>'+table(['Target','Planned','Recorded','Difference','Original review met'],r.targets.map(row=>[esc(label(row.key)),esc(fixed(row.planned)),esc(fixed(row.observed)),esc(fixed(row.delta)),esc(fixed(row.observedMet))]))+
      '<h3>Daily delivery</h3><p>Recorded attempts follow first-attempt date. Delivered-on-date counts current completed outputs on their actual UTC date.</p>'+
      table(['UTC date','Planned purchases','Recorded attempts','Completed from attempts','Delivered on date','Unmatched'],r.days.map(row=>[esc(row.date),row.plannedCompletePurchases,row.observedIntents,row.completedFromAttempts,row.completedOnDate,row.unmatchedIntents]))+
      '<h3>Accountable buyer operators</h3>'+table(['Buyer / operator','Planned independent','Recorded intents','Recorded independent','Unmatched'],r.operators.map(row=>[esc(row.labels.join('; '))+'<small>'+esc(row.operatorId||'Unassigned')+'</small>',row.plannedIndependentOpportunities,row.observedIntents,row.observedIndependentComplete,row.unmatchedIntents]));
  }
  function identity(){
    const r=state.report;if(!r)return '<p class="cd-empty">Open a comparison first.</p>';
    const kinds=[['buyer','Buyer'],['merchant','Merchant'],['operation','Useful operation'],['facilitator','Facilitator']],kind=state.linkKind||'buyer';
    const planned=r.joins.filter(row=>row.kind===kind),c=r.input.review.cohort;
    const observed=kind==='operation'?c.inputs.operations:kind==='facilitator'?c.inputs.facilitators:c.selectedDeployments.filter(row=>kind==='buyer'?['BUYER','BOTH'].includes(row.role):['MERCHANT','BOTH'].includes(row.role));
    return '<p>Original deployment and operator identities match automatically. Useful operations also retain their original scope and expected output. Use a named association when the plan used a different identity.</p>'+
      '<form data-cd-form="identity" class="cd-form"><label>Identity kind<select name="kind" data-cd-field="linkKind">'+kinds.map(([id,name])=>'<option value="'+id+'"'+(kind===id?' selected':'')+'>'+name+'</option>').join('')+'</select></label>'+
      '<label>Planned identity<select name="plannedId" required>'+choices(planned.map(row=>[row.plannedId,row.plannedLabel+' · '+row.plannedId]),'')+'</select></label>'+
      '<label>Recorded identity<select name="observedId" required>'+choices(observed.map(row=>[row.id,(row.name||row.label||row.id)+' · '+row.id]),'')+'</select></label>'+
      '<label class="cd-wide">Why these refer to the same original participant or operation<textarea name="note" required rows="2"></textarea></label><button type="submit"'+(pending()?' disabled data-cd-fixed="true"':'')+'>Save association in comparison</button></form>'+
      table(['Kind','Planned identity','Recorded identity','Basis / note',''],r.joins.map(row=>[esc(label(row.kind)),esc(row.plannedLabel)+'<small>'+esc(row.plannedId)+'</small>',esc(row.observedLabel||'Unassigned')+'<small>'+esc(row.observedId||'')+'</small>',esc(label(row.basis))+'<small>'+esc(row.note)+'</small>',row.basis==='OPERATOR_ASSOCIATION'?btn('Use original matching','remove-link','data-kind="'+esc(row.kind)+'" data-id="'+esc(row.plannedId)+'"',pending()):'']));
  }
  function placement(){
    const r=state.report;if(!r)return '<p class="cd-empty">Open a comparison first.</p>';
    const selected=state.editIntent?r.records.find(row=>row.id===state.editIntent):null,targets=new Map(r.rows.map(row=>[row.id,row]));
    const candidateTargetIds=selected?r.candidateGroups.find(row=>row.id===selected.candidateGroupId)?.targetIds||[]:[];
    let rows=r.records;if(state.search.trim()){const q=state.search.toLowerCase();rows=rows.filter(row=>[row.id,row.intentId,row.operationId,row.buyerOperatorId,...row.purchaseIds].join(' ').toLowerCase().includes(q));}
    const page=pager(rows);
    const form=selected?'<section class="cd-panel"><h3>Place original intent '+esc(selected.intentId||selected.id)+'</h3><p>'+esc(stamp(selected.firstAttemptAt))+' · '+esc(selected.operationId||'Useful operation unassigned')+'</p>'+
      (candidateTargetIds.length?'<form data-cd-form="placement" class="cd-form"><label class="cd-wide">Planned opportunity with matching identities<select name="targetId" required>'+choices(candidateTargetIds.map(id=>{const target=targets.get(id);return[id,target.date+' · '+target.label+' · '+id];}),selected.targetId)+'</select></label><label class="cd-wide">Original basis for placing this intent<textarea name="note" required rows="2">'+esc(selected.assignmentNote)+'</textarea></label><button type="submit"'+(pending()?' disabled data-cd-fixed="true"':'')+'>Save placement</button></form>':'<p>Associate the original participants and useful operation on the Identity associations tab. Candidate opportunities retain the same network, asset and selected facilitator.</p>')+
      btn('Close placement','close-placement')+'</section>':'';
    return '<p>Each original intent group is counted once, including repeated purchase observations. An unambiguous identity and UTC date match is automatic. Explicit placement can preserve a later or earlier delivery date.</p>'+form+
      '<label class="cd-search">Search original intents<input data-cd-field="search" value="'+esc(state.search)+'" placeholder="Buyer, operation, intent or purchase"></label>'+
      table(['Original intent / operator','First attempt / current output','Native result','Placement',''],page.rows.map(row=>[
        esc(row.intentId||'Unidentified intent')+'<small>'+esc(row.buyerOperatorId||'Unassigned operator')+'<br>'+esc(row.id)+'</small>',
        esc(stamp(row.firstAttemptAt))+'<small>Output: '+esc(stamp(row.currentCompletedAt))+'</small>',
        (row.independentCompleteInWindow?'Independent complete':row.completeInWindow?'Complete':row.refundedAfterSettlement?'Refunded':row.cancelledAfterSettlement?'Canceled after settlement':row.settled?'Settled; output pending':row.attempted?'Attempted':'No placed attempt')+(row.lateAfterPlan?'<small>'+esc(row.latenessSeconds)+' seconds after plan</small>':''),
        esc(row.targetId||label(row.placement))+'<small>'+esc(row.assignmentNote)+'</small>',
        btn('Place','edit-intent','data-id="'+esc(row.id)+'"',pending())+(row.placement==='OPERATOR_ASSIGNMENT'?btn('Use automatic match','remove-assignment','data-id="'+esc(row.id)+'"',pending()):'')
      ]))+page.html;
  }


  function originalCostView(){
    if(!state.input)return '';
    let catalog;
    try{catalog=inspectCohortOriginalCosts(state.input);}catch(error){return '<h3>Original case costs</h3><p>'+esc(error.message)+'</p>';}
    const selected=catalog.selection,output=state.report?.commercial?.originalCostIntake;
    const rows=new Map(catalog.rows.map(row=>[row.sourceKey,row])),reviews=new Map(catalog.sourceReviews.map(row=>[row.selectionId,row]));
    let services=state.report?.planReport?.servicePricing||[];
    if(!state.report){try{const base=copy(state.input);delete base.commercial;services=compareCohortDelivery(base).planReport.servicePricing||[];}catch{}}
    const disabled=pending()?' disabled data-cd-fixed="true"':'';
    const submit=title=>'<button type="submit"'+disabled+'>'+esc(title)+'</button>';
    const amounts=new Map((output?.rows||[]).map(row=>[row.sourceKey,row]));
    const work=new Set(selected.selections.filter(row=>rows.get(row.sourceKey)?.kind==='WORK').map(row=>rows.get(row.sourceKey).recordId));
    const pairs=catalog.rows.filter(row=>row.kind==='INVOICE_LINE'&&selected.selections.some(x=>x.sourceKey===row.sourceKey))
      .flatMap(row=>row.workIds.filter(id=>work.has(id)).map(id=>({workId:id,invoiceId:row.recordId,lineId:row.lineId})));
    const pairKey=row=>JSON.stringify([row.workId,row.invoiceId,row.lineId]);
    return '<h3>Original Work and supplier invoice costs</h3><p>'+esc(catalog.note)+'</p>'+
      '<p>Select a source row to enter the actual portion, service and value basis. Existing quantities and rates remain unchanged when a new frozen review is selected. Changed source context requires explicit acceptance below. Invoice-linked Work remains visible for overlap review.</p>'+
      table(['Original record / state','Contributor / dates','Recorded quantity','Selected / unselected','Whole original context',''],
        catalog.rows.map(row=>[esc(row.label)+'<small>'+esc(row.recordId+(row.lineId?' / '+row.lineId:''))+' · '+esc(row.state)+'</small>',
          esc(row.contributorName)+'<small>'+esc(row.periodStart+' through '+row.periodEnd)+'</small>',esc(row.quantity+' '+row.unit),
          amounts.has(row.sourceKey)?esc(amounts.get(row.sourceKey).selectedQuantity+' / '+amounts.get(row.sourceKey).unselectedQuantity):
          esc(selected.selections.filter(x=>x.sourceKey===row.sourceKey).map(x=>x.quantity).join(' + ')||'0')+'<small>Recalculate for remaining balance</small>',
          detail('Original record, linked Work and source attachments',row.source),btn('Select portion','commercial-original-select','data-key="'+esc(row.sourceKey)+'"',pending()||row.state==='VOID')]))+
      '<h4>Selected portions</h4>'+
      table(['Selection / original record','Portion / value per unit','Selected dates / service','Source status / basis',''],
        selected.selections.map(row=>[esc(row.id)+'<small>'+esc(rows.get(row.sourceKey)?.label||row.sourceKey)+'</small>',
          esc(row.quantity)+' / '+esc(fixed(row.unitCost)),esc(row.periodStart+' through '+row.periodEnd)+'<small>'+esc(row.serviceId||'Whole comparison')+'</small>',
          esc(reviews.get(row.id)?.status||'MISSING')+'<small>'+esc(row.allocationNote)+'</small>'+detail('Retained and current original source',reviews.get(row.id)),
          btn('Edit portion','commercial-original-edit','data-id="'+esc(row.id)+'"',pending())+btn('Remove portion','commercial-original-remove','data-id="'+esc(row.id)+'"',pending())]))+
      '<form data-cd-form="commercial-original-selection" class="cd-form"><label>Selection ID (blank creates one)<input name="id" maxlength="200"></label>'+
      '<label class="cd-wide">Original Work or invoice line<select name="sourceKey" required>'+choices(catalog.rows.map(row=>[row.sourceKey,row.label+' · '+row.quantity+' '+row.unit]),'')+'</select></label>'+
      '<label>Actual selected portion<input name="quantity" inputmode="decimal" required></label>'+
      '<label>Complete service component<select name="serviceId">'+choices(services.map(row=>[row.id,row.label+' · '+row.id]),'','Whole comparison / shared overhead')+'</select></label>'+
      '<label>Value per hour or original USD ('+esc(state.input.commercial?.currency||'selected currency')+')<input name="unitCost" inputmode="decimal"></label>'+
      '<label>Value source as of (UTC)<input name="valuationAt" type="datetime-local" step="1"></label>'+
      '<label class="cd-wide">Dated hourly-cost / currency-conversion source<textarea name="valuationSource" rows="2"></textarea></label>'+
      '<label>Selected period start<input name="periodStart" type="date" required></label><label>Selected period end<input name="periodEnd" type="date" required></label>'+
      '<label class="cd-wide">Actual portion and service basis<textarea name="allocationNote" required rows="2"></textarea></label>'+
      '<label>Current original record<select name="acceptSource"><option value="">Keep the retained source witness</option><option value="yes">I reviewed and accept the complete current original source</option></select></label>'+
      '<p class="cd-wide">For a new selection the complete original source is retained. For an existing selection, choose explicit acceptance only after reading its current and retained source above. A USD invoice uses one USD per original USD. Other values remain unknown until entered; recorded Work intervals are not automatically prorated.</p>'+
      submit('Save selected portion')+'</form>'+
      '<h4>Invoice-linked Work review</h4><p>When both the Work and its linked invoice line are selected, remove the duplicate portion or record the actual reason they are distinct costs. The complete contribution stays unknown until each overlap is resolved.</p>'+
      table(['Original Work','Supplier invoice / line','Review / source explanation'],pairs.map(row=>{
        const review=selected.overlapReviews.find(x=>pairKey(x)===pairKey(row));
        return [esc(row.workId),esc(row.invoiceId+' / '+row.lineId),review?esc(review.note):'<strong>Review required</strong>'];
      }))+
      '<form data-cd-form="commercial-original-overlap" class="cd-form"><label class="cd-wide">Selected original overlap<select name="pair" required>'+choices(pairs.map(row=>[pairKey(row),row.workId+' / '+row.invoiceId+' / '+row.lineId]),'')+'</select></label>'+
      '<label class="cd-wide">Source explanation for distinct costs<textarea name="note" required rows="3"></textarea></label>'+submit('Retain distinct-cost review')+'</form>'+
      table(['Retained overlap review','Source explanation',''],selected.overlapReviews.map(row=>[
        esc(row.workId+' / '+row.invoiceId+' / '+row.lineId)+(pairs.some(x=>pairKey(x)===pairKey(row))?'':'<small>Retained; no longer an active overlap</small>'),
        esc(row.note),btn('Remove review','commercial-original-remove-review','data-key="'+esc(pairKey(row))+'"',pending())]))+
      '<form data-cd-form="commercial-original-note" class="cd-form"><label class="cd-wide">Complete original cost selection note<textarea name="note" rows="2">'+esc(selected.note)+'</textarea></label>'+submit('Save selection note')+'</form>'+
      detail('Complete original cost selection and current source catalog',catalog);
  }

  function commercialView(){
    const r=state.report;if(!r)return state.input?originalCostView()+'<details><summary>Repair the complete retained commercial choices</summary><p>The whole source input remains available above. Edit exact retained commercial choices here if a service, valuation or prior allocation also needs correction.</p><form data-cd-form="commercial-repair" class="cd-form"><label class="cd-wide">Complete commercial JSON<textarea name="commercial" rows="12" required>'+esc(JSON.stringify(state.input.commercial,null,2))+'</textarea></label><button type="submit"'+(pending()?' disabled data-cd-fixed="true"':'')+'>Apply retained commercial choices</button></form></details>':'<p class="cd-empty">Open a comparison first.</p>';
    if(!r.commercial)return '<h3>Commercial reconciliation</h3><p>Compare original settled payments and fees with the saved adoption plan. Add dated asset valuations, original service costs and refund values, then save the complete comparison in this same case.</p>'+btn('Start commercial reconciliation','commercial-start','',pending());
    const c=r.commercial,o=state.input.commercial;
    const options=(rows,value)=>rows.map(([id,name])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(name)+'</option>').join('');
    const assetRows=[...new Map([...r.planReport.assets,...c.transactions,...c.transactions.map(row=>({network:row.network,asset:'native:XLM'}))].map(row=>[JSON.stringify([row.network,row.asset]),row])).entries()];
    const utc=value=>new Date(value).toISOString().slice(0,19),disabled=pending()?' disabled data-cd-fixed="true"':'';
    const sourceField='<label class="cd-wide">Original source reference and value basis<textarea name="sourceReference" required rows="2"></textarea></label>';
    const atField='<label>Occurred at (UTC)<input type="datetime-local" name="occurredAt" step="1" required value="'+esc(utc(c.window.asOfAt))+'"></label>';
    const submit=title=>'<button type="submit"'+disabled+'>'+esc(title)+'</button>';
    const known=[['Gross settlement value',c.actual.grossSettlementValue],['Refund value',c.actual.refunds],['Other revenue',c.actual.otherRevenue],['Adjusted revenue',c.actual.adjustedRevenue],['Recorded service cost',c.actual.recordedCost],['Network fee value',c.actual.networkFeeValue],['Complete total cost',c.actual.totalCost],['Contribution',c.actual.contribution]];
    const txPage=pager(c.transactions);
    return '<h3>Commercial reconciliation · '+esc(c.currency)+'</h3><p>Original transaction amounts and network fees remain exact. Currency values use your selected dated valuations. The full prospective plan stays beside the actual review window '+esc(c.window.start)+'–'+esc(c.window.end)+' and cutoff '+esc(stamp(c.window.asOfAt))+'.</p>'+
      table(['Measure','Saved plan','Recorded / valued','Difference'],[['Revenue',c.planned?.revenue,c.actual.adjustedRevenue,c.differences.revenue],['Total cost',c.planned?.totalCost,c.actual.totalCost,c.differences.totalCost],['Contribution',c.planned?.contribution,c.actual.contribution,c.differences.contribution]].map(row=>row.map(x=>esc(fixed(x)))))+
      table(['Recorded measure','Value'],known.map(row=>row.map(x=>esc(fixed(x)))))+
      '<form data-cd-form="commercial-settings" class="cd-form"><label>Reporting currency<input name="currency" required maxlength="16" value="'+esc(o.currency)+'"></label>'+
      '<label>Original transaction population<select name="transactionScope">'+options([['SETTLED_IN_WINDOW','Settled inside the original review window'],['FIRST_ATTEMPT_IN_WINDOW','Original intent first attempted inside the window']],o.transactionScope)+'</select></label>'+
      '<label>Native network fees<select name="feeTreatment">'+options([['SEPARATE','Show separately from service costs'],['INCLUDE_AS_COST','Include as an additional operator-borne cost']],o.feeTreatment)+'</select></label>'+
      '<label>Recorded service-cost coverage<select name="costCoverage">'+options([['PARTIAL','Costs still being recorded'],['COMPLETE','Complete selected-window cost coverage']],o.costCoverage)+'</select></label>'+
      '<label class="cd-wide">Complete-coverage source basis<textarea name="coverageNote" rows="2">'+esc(o.coverageNote)+'</textarea></label>'+
      '<label class="cd-wide">Commercial review note<textarea name="note" rows="2">'+esc(o.note)+'</textarea></label>'+submit('Save reporting choices')+'</form>'+
      '<h3>Payment amounts and original opportunities</h3>'+table(['Network','Exact asset','Planned atomic','Recorded atomic','Difference','Unknown transactions'],c.assets.map(row=>[row.network,row.asset,row.plannedAtomic,row.observedAtomic,row.differenceAtomic,row.unresolvedTransactions].map(x=>esc(fixed(x)))))+
      '<p>Shared transaction proof is counted once. Allocate its whole amount explicitly when it funds multiple placed opportunities. Each allocation must sum to the exact original amount; its candidate opportunities retain the same original intents, network and asset.</p>'+
      table(['Original transaction','Atomic amount / fee stroops','Selected value','Scope / placement'],txPage.rows.map(row=>[
        esc(row.network)+'<small>'+esc(row.transactionHash)+'</small>',esc(fixed(row.amountAtomic))+' / '+esc(fixed(row.feesAtomic)),esc(fixed(row.valuedAmount)),
        esc(row.included?'Included':'Outside selected population')+'<small>'+esc(row.allocationBasis)+'</small>'+detail('Original proof, candidates and complete allocation',row)
      ]))+txPage.html+
      '<details><summary>Allocate one original transaction across its opportunities</summary><form data-cd-form="commercial-allocation" class="cd-form"><label class="cd-wide">Original transaction<select name="transactionKey" required>'+choices(c.transactions.filter(row=>row.candidateTargetIds.length&&row.amountAtomic!==null).map(row=>[row.id,row.network+' / '+row.transactionHash+' · '+row.amountAtomic]),'')+'</select></label>'+
      '<label class="cd-wide">Complete allocation parts JSON<textarea name="parts" rows="5" required placeholder=\'[{"targetId":"funding:original-id","amountAtomic":"1000"}]\'></textarea></label><label class="cd-wide">Original allocation basis<textarea name="note" required rows="2"></textarea></label>'+submit('Save complete transaction allocation')+'</form>'+
      table(['Transaction','Parts','Source basis',''],o.transactionAllocations.map(row=>[esc(row.network+' / '+row.transactionHash),esc(JSON.stringify(row.parts)),esc(row.note),btn('Use original intent placement','commercial-remove-allocation','data-key="'+esc(JSON.stringify([row.network,row.transactionHash.toLowerCase()]))+'"',pending())]))+'</details>'+
      '<h3>Dated asset valuations</h3><p>Enter the original asset decimal places and its value per whole unit in '+esc(o.currency)+'. Native XLM fees use seven decimal places. Keep the actual valuation time and source; different networks and assets retain separate rows.</p>'+
      '<form data-cd-form="commercial-valuation" class="cd-form"><label class="cd-wide">Exact original network / asset<select name="assetKey" required>'+choices(assetRows.map(([key,row])=>[key,row.network+' / '+row.asset]),'')+'</select></label>'+
      '<label>Original decimal places<input type="number" min="0" max="30" step="1" name="atomicDecimals" required></label><label>'+esc(o.currency)+' per whole unit<input name="unitValue" inputmode="decimal" required></label>'+
      '<label>Valuation as of (UTC)<input type="datetime-local" step="1" name="asOfAt" required value="'+esc(utc(c.window.asOfAt))+'"></label>'+sourceField+submit('Save selected valuation')+'</form>'+
      table(['Network / asset','Whole-unit value','Decimal places','As of / source',''],o.valuations.map(row=>[esc(row.network+' / '+row.asset),esc(row.unitValue),row.atomicDecimals,esc(stamp(row.asOfAt))+'<small>'+esc(row.sourceReference)+'</small>',btn('Remove valuation','commercial-remove-valuation','data-key="'+esc(JSON.stringify([row.network,row.asset]))+'"',pending())]))+
      '<h3>Actual service costs</h3><p>Each row enters the total once. A complete service component retains all linked funding groups and shared useful results. Labor uses active hours × hourly cost. Blank amounts stay unknown; enter 0 for a known zero. Keep network fees separate here when the reporting choice includes them automatically.</p>'+
      '<form data-cd-form="commercial-cost" class="cd-form"><label>Original cost ID (blank creates one)<input name="id" maxlength="200"></label><label>Description<input name="label" required maxlength="500"></label>'+
      '<label>Complete service component<select name="serviceId">'+choices((r.planReport.servicePricing||[]).map(row=>[row.id,row.label+' · '+row.id]),'','Whole comparison / shared overhead')+'</select></label>'+
      '<label>Kind<select name="costType">'+options([['SUPPLIER','Supplier'],['LABOR','Active labor'],['PAYMENT_FEE','Other payment fee'],['OTHER','Other service cost']],'SUPPLIER')+'</select></label>'+
      '<label>Non-labor amount ('+esc(o.currency)+')<input name="amount" inputmode="decimal"></label><label>Labor active hours<input name="activeHours" inputmode="decimal"></label><label>Labor hourly cost ('+esc(o.currency)+')<input name="hourlyCost" inputmode="decimal"></label>'+
      atField+sourceField+submit('Save original cost')+'</form>'+
      table(['Original cost','Component / kind','Amount','Active hours / rate','Source',''],c.costs.filter(row=>!row.originalCost).map(row=>[esc(row.label)+'<small>'+esc(row.id)+'</small>',esc(row.serviceId||'Whole comparison')+'<small>'+esc(row.costType)+'</small>',esc(fixed(row.calculatedAmount)),esc(fixed(row.activeHours))+' / '+esc(fixed(row.hourlyCost)),esc(stamp(row.occurredAt))+'<small>'+esc(row.sourceReference)+'</small>',btn('Remove cost','commercial-remove-cost','data-id="'+esc(row.id)+'"',pending())]))+
      originalCostView()+'<h3>Refunds and other revenue adjustments</h3><p>Retain each original refund cash row and refunded intent once. Enter its selected-currency value and source basis. These adjustments affect the comparison; the original cash record and accounting books remain their maintained sources.</p>'+
      '<form data-cd-form="commercial-adjustment" class="cd-form"><label>Original adjustment ID (blank creates one)<input name="id" maxlength="200"></label><label>Description<input name="label" required maxlength="500"></label>'+
      '<label>Kind<select name="kind">'+options([['REFUND','Customer refund (deduct)'],['OTHER_REVENUE','Other revenue (add)']],'REFUND')+'</select></label><label>Amount ('+esc(o.currency)+')<input name="amount" inputmode="decimal" required></label>'+
      '<label>Original refund cash record<select name="refundCashId">'+choices(c.originalRefundCash.filter(row=>row.inWindow&&row.atCutoff).map(row=>[row.id,row.id+' · '+row.currency+' '+row.amount]),'','Separate source reference')+'</select></label>'+
      '<label>Original refunded intents (select all covered)<select name="intentIds" multiple size="4">'+r.records.filter(row=>row.refundedAfterSettlement).map(row=>'<option value="'+esc(row.id)+'">'+esc(row.intentId||row.id)+'</option>').join('')+'</select></label>'+
      atField+sourceField+submit('Save adjustment')+'</form>'+
      table(['Adjustment','Kind / amount','Original refund / intents','Source',''],c.adjustments.map(row=>[esc(row.label)+'<small>'+esc(row.id)+'</small>',esc(row.kind)+' / '+esc(row.amount),esc(row.refundCashId)+'<small>'+esc(row.intentIds.join(', '))+'</small>',esc(row.sourceReference),btn('Remove adjustment','commercial-remove-adjustment','data-id="'+esc(row.id)+'"',pending())]))+
      '<h3>Coverage and source findings</h3>'+table(['Finding','Original source','Action'],c.issues.map(row=>[esc(row.code),esc(row.id),esc(row.message)]))+
      '<details><summary>Complete commercial choices and original shared services</summary>'+detail('Editable commercial input',o)+detail('Shared service comparison',c.services)+detail('Original refund cash',c.originalRefundCash)+'</details>'+
      '<p>Save the comparison edition above to retain the complete commercial choices, original source documents and report. JSON, CSV and readable HTML include the complete reconciliation.</p>';
  }

  function sourceView(){
    const r=state.report,files=(caseValue.sources||[]).filter(row=>row.filename?.startsWith('sf47-cohort-delivery-'));
    return '<h3>Saved comparison editions</h3><div class="cd-tools"><label>Original case source<select data-cd-field="selectedSource">'+choices(files.map(row=>[row.id,row.filename+' · '+stamp(row.observedAt||row.createdAt)]),state.selectedSource)+'</select></label>'+btn('Open saved comparison','open-source','',!state.selectedSource||pending())+btn('Download complete case','case-export')+'</div>'+
      (r?'<h3>Original documents</h3><div class="cd-actions">'+btn('Download selected plan JSON','original-plan')+btn('Download original cohort JSON','original-review')+btn('Download original cohort archive','review-export')+btn('Download editable comparison input','input-json')+'</div>'+
      table(['Original source','Value'],[['Case',r.source.programId],['Plan revision',r.source.plan.planContentSha256],['Frozen review',r.source.reviewId],['Measurement',r.source.measurementSha256],['Recorded mode',r.source.nativeMode],['Planned window',r.source.plannedWindow.start+' through '+r.source.plannedWindow.end],['Observed window',r.source.observedWindow.start+' through '+r.source.observedWindow.end],['Observed cutoff',r.source.observedWindow.asOfAt]].map(row=>row.map(esc)))+
      '<h3>Source differences and original review findings</h3>'+table(['Finding','Identity','Description'],[...r.issues,...r.nativeIssues].map(row=>[esc(row.code),esc(row.id||''),esc(row.message)]))+
      detail('Recorded amounts by network and asset',r.amounts)+detail('Recorded recovery and support outcomes',r.outcomes)+detail('Complete parent products',r.products)+detail('Original frozen cohort review',r.input.review)+detail('Complete original adoption document',r.input.planDocument):'');
  }
  function render(){
    if(!available())return;
    const plans=(caseValue.sources||[]).filter(row=>row.filename?.startsWith('sf47-cohort-plan-tranche-'));
    const reviews=(caseValue.reviews||[]).filter(row=>row.purpose==='COHORT_EVALUATION');
    const r=state.report;
    root.innerHTML='<header class="cd-heading"><div><h2>Cohort delivery</h2><p>Compare the saved adoption plan with recorded customer delivery.</p></div><div class="cd-actions">'+btn('Refresh case','refresh')+btn('Open JSON','import')+'<input type="file" accept=".json,application/json" data-cd-import hidden></div></header>'+
      (state.error?'<p class="cd-error" role="alert">'+esc(state.error)+'</p>':'')+
      (state.repair?'<section class="cd-panel"><h3>Retained editable successor</h3><p>'+esc(state.repair.code+' · '+state.repair.message)+'<small>'+esc(state.repair.path)+'</small></p><p>The complete selected quantities, rates, overlap reviews and source witnesses are retained. Correct the selection below before saving a calculated edition.</p>'+btn('Download complete editable successor','input-json')+(state.previousInput?btn('Download predecessor input','previous-input-json'):'')+'</section>':'')+
      (state.notice?'<p class="cd-notice" role="status">'+esc(state.notice)+'</p>':'')+
      (state.storageNotice?'<p class="cd-notice">'+esc(state.storageNotice)+'</p>':'')+
      (pending()?'<p class="cd-notice">The original save request is retained. '+btn(state.accepted?'Reopen accepted source':'Resume same save','resume')+btn('Download retained request JSON','pending-json')+'</p>':'')+
      '<section class="cd-panel"><div class="cd-source-picker"><label>Saved adoption plan<select data-cd-field="selectedPlan">'+choices(plans.map(row=>[row.id,row.filename]),state.selectedPlan,plans.length?'Select saved plan…':'Save a plan in Customer adoption plan')+'</select></label>'+
      '<label>Original frozen cohort review<select data-cd-field="selectedReview">'+choices(reviews.map(row=>[row.id,(row.cohortName||row.id)+' · '+stamp(row.createdAt)]),state.selectedReview,reviews.length?'Select frozen review…':'Freeze a review in Cohort acceptance')+'</select></label>'+
      btn('Compare selected sources','load','',!state.selectedPlan||!state.selectedReview||pending())+btn('Refresh selected sources and keep choices','refresh-selection','',!state.input||!state.selectedPlan||!state.selectedReview||pending())+'</div></section>'+
      (r?'<section class="cd-panel"><div class="cd-heading"><div><h3>'+esc(r.title)+'</h3><p>Tranche '+r.source.plannedWindow.tranche+' · '+esc(r.source.nativeMode)+' · observed through '+esc(stamp(r.source.observedWindow.asOfAt))+'</p></div><div class="cd-actions">'+btn('Save comparison edition','save')+btn('JSON','json')+btn('CSV','csv')+btn('Readable HTML','html')+'</div></div>'+
      '<form data-cd-form="details" class="cd-form"><label>Comparison title<input name="title" value="'+esc(state.input.title)+'" required maxlength="500"></label><label>Operator note<input name="note" value="'+esc(state.input.note)+'"></label><button type="submit"'+(pending()?' disabled data-cd-fixed="true"':'')+'>Update title and note</button></form></section>':'')+
      parkedComparisons()+'<nav class="cd-tabs" aria-label="Cohort delivery sections">'+[['report','Delivery report'],['identity','Identity associations'],['placement','Original intent placement'],['commercial','Commercial reconciliation'],['sources','Saved editions and sources']].map(([id,name])=>btn(name,'tab','data-tab="'+id+'"'+(state.tab===id?' aria-current="page"':''))).join('')+'</nav>'+
      '<div class="cd-content">'+({report:overview,identity,placement,commercial:commercialView,sources:sourceView}[state.tab]||overview)()+'</div>';
    for(const [kind,values]of Object.entries(state.commercialDrafts||{})){
      const form=root.querySelector('form[data-cd-form="'+kind+'"]');if(!form)continue;
      for(const [name,value]of Object.entries(values)){
        const field=form.elements.namedItem(name);if(!field)continue;
        if(field.multiple)for(const option of field.options)option.selected=(Array.isArray(value)?value:[value]).includes(option.value);
        else field.value=value;
      }
    }
    controls();
  }
  function retainCommercialDraft(event){
    const form=event.target.closest('form[data-cd-form]');if(!form?.dataset.cdForm?.startsWith('commercial-'))return;
    const values=Object.fromEntries(new FormData(form));if(form.dataset.cdForm==='commercial-adjustment')values.intentIds=new FormData(form).getAll('intentIds');
    state.commercialDrafts??={};state.commercialDrafts[form.dataset.cdForm]=values;persist();
  }
  root.addEventListener('input',retainCommercialDraft);
  root.addEventListener('change',retainCommercialDraft);
  root.addEventListener('change',event=>{
    const field=event.target.dataset.cdField;
    if(!field)return;
    state[field]=event.target.value;
    if(['filter','search','linkKind'].includes(field)){state.page=0;render();}else controls();
    if(['selectedPlan','selectedReview','selectedSource'].includes(field))render();
    persist();
  });
  root.addEventListener('submit',event=>{
    const form=event.target.closest('form[data-cd-form]');if(!form)return;event.preventDefault();
    run(async()=>{
      requireEditable();if(!state.input)throw new Error('Open a comparison first.');
      const values=Object.fromEntries(new FormData(form));let next=copy(state.input);
      if(form.dataset.cdForm.startsWith('commercial-')){
        if(!next.commercial)throw new Error('Start the commercial reconciliation first.');
        const c=next.commercial,type=form.dataset.cdForm;
        const iso=value=>new Date(value+'Z').toISOString();
        const upsert=(rows,row)=>{const i=rows.findIndex(x=>x.id===row.id);if(i<0)rows.push(row);else rows[i]=row;};
        if(type==='commercial-repair'){next.commercial=JSON.parse(values.commercial);
        }else if(type.startsWith('commercial-original-')){
          const catalog=inspectCohortOriginalCosts(next),selection=copy(catalog.selection);delete selection.schema;
          if(type==='commercial-original-selection'){
            const {acceptSource,...authored}=values;
            const id=authored.id.trim()||'original-cost-'+crypto.randomUUID();
            const prior=selection.selections.find(row=>row.id===id);
            const row={...authored,id,unitCost:authored.unitCost||null,valuationAt:authored.valuationAt?iso(authored.valuationAt):'',
              ...(prior?{source:prior.source}:{})};
            upsert(selection.selections,row);
            selection.acceptSourceIds=acceptSource==='yes'?[id]:[];
          }else if(type==='commercial-original-overlap'){
            const [workId,invoiceId,lineId]=JSON.parse(values.pair);
            selection.overlapReviews=selection.overlapReviews.filter(row=>JSON.stringify([row.workId,row.invoiceId,row.lineId])!==values.pair);
            selection.overlapReviews.push({workId,invoiceId,lineId,note:values.note});
          }else if(type==='commercial-original-note')selection.note=values.note;
          next=selectCohortOriginalCosts(next,selection);
        }else if(type==='commercial-settings'){
          if(values.currency!==c.currency&&(c.valuations.length||c.costs.length||c.adjustments.length||c.originalCosts?.selections.length))throw new Error('Keep the currency of retained values. Remove their selected valuation, cost and adjustment rows before choosing a different currency.');
          Object.assign(c,values);
        }else if(type==='commercial-valuation'){
          const [network,asset]=JSON.parse(values.assetKey),row={network,asset,atomicDecimals:Number(values.atomicDecimals),unitValue:values.unitValue,asOfAt:iso(values.asOfAt),sourceReference:values.sourceReference};
          c.valuations=c.valuations.filter(x=>x.network!==network||x.asset!==asset);c.valuations.push(row);
        }else if(type==='commercial-cost'){
          upsert(c.costs,{...values,id:values.id.trim()||'cost-'+crypto.randomUUID(),occurredAt:iso(values.occurredAt),amount:values.amount||null,activeHours:values.activeHours||null,hourlyCost:values.hourlyCost||null});
        }else if(type==='commercial-adjustment'){
          upsert(c.adjustments,{...values,id:values.id.trim()||'adjustment-'+crypto.randomUUID(),occurredAt:iso(values.occurredAt),intentIds:new FormData(form).getAll('intentIds')});
        }else if(type==='commercial-allocation'){
          const [network,transactionHash]=JSON.parse(values.transactionKey),row={network,transactionHash,parts:JSON.parse(values.parts),note:values.note};
          c.transactionAllocations=c.transactionAllocations.filter(x=>x.network!==network||x.transactionHash.toLowerCase()!==transactionHash.toLowerCase());c.transactionAllocations.push(row);
        }
      }else if(form.dataset.cdForm==='identity'){
        next.links=next.links.filter(row=>!(row.kind===values.kind&&row.plannedId===values.plannedId));next.links.push(values);
      }else if(form.dataset.cdForm==='placement'){
        next.assignments=next.assignments.filter(row=>row.intentId!==state.editIntent);next.assignments.push({intentId:state.editIntent,...values});
      }else{next.title=values.title;next.note=values.note;}
      recalculate(next);if(form.dataset.cdForm.startsWith('commercial-')&&state.commercialDrafts)delete state.commercialDrafts[form.dataset.cdForm];state.notice='Updated this comparison with its original source documents retained.';
    });
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-cd-action]');if(!target||target.disabled)return;
    const action=target.dataset.cdAction;
    if(action==='import'){if(!locked())$('[data-cd-import]').click();return;}
    run(async()=>{
      if(action==='tab'){state.tab=target.dataset.tab;state.page=0;return;}
      if(action==='previous'){state.page--;return;}if(action==='next'){state.page++;return;}
      if(action==='refresh'){await refresh();state.notice='Refreshed the current case source list.';return;}
      if(action==='download-parked'||action==='resume-parked'){
        const retained=state.parkedComparisons.find(row=>row.id===target.dataset.id);
        if(!retained)throw new Error('The retained comparison is absent from this original desk.');
        if(action==='download-parked')return download(JSON.stringify({schema:SESSION,caseId,...retained},null,2)+'\n',clean(retained.input.title)+'-comparison-draft.json');
        openDocument({schema:SESSION,caseId,...retained},true);state.savedSourceId=retained.savedSourceId;
        state.tab=retained.tab||'report';state.notice='Resumed the complete retained comparison draft and commercial fields.';return;
      }
      if(action==='load'||action==='refresh-selection'){
        requireEditable();
        const meta=caseValue.sources.find(row=>row.id===state.selectedPlan);
        if(!meta)throw new Error('Select an original saved adoption plan.');
        const plan=JSON.parse(await readSource(meta)),review=await saveApi(prefix+'/reviews/'+encodeURIComponent(state.selectedReview));
        const next=seedCohortDeliveryComparison(plan,review,{planSourceId:meta.id});
        if(next.review.cohort.source.programId!==caseId)throw new Error('The original cohort belongs to another case.');
        parkComparison(next);
        if(action==='refresh-selection'){
          state.previousInput=copy(state.input);
          Object.assign(next,{title:state.input.title,note:state.input.note,links:copy(state.input.links),assignments:copy(state.input.assignments)});
          if(state.input.commercial)next.commercial=copy(state.input.commercial);
        }
        recalculate(next);state.tab=state.repair?'commercial':'report';
        state.notice=action==='refresh-selection'?'Selected full current sources and retained every original quantity, rate and overlap review.':'Opened the original saved adoption plan and frozen cohort review.';return;
      }
      if(action==='previous-input-json')return download(JSON.stringify(state.previousInput,null,2)+'\n','cohort-delivery-predecessor-input.json');
      if(action.startsWith('commercial-original-')){
        requireEditable();const catalog=inspectCohortOriginalCosts(state.input),selection=copy(catalog.selection);delete selection.schema;
        if(action==='commercial-original-select'||action==='commercial-original-edit'){
          const current=action==='commercial-original-edit'?selection.selections.find(row=>row.id===target.dataset.id):null;
          const source=catalog.rows.find(row=>row.sourceKey===(current?.sourceKey||target.dataset.key));
          if(!source&&!current)throw new Error('Select the complete current original cost.');
          state.commercialDrafts??={};
          state.commercialDrafts['commercial-original-selection']=current?{...current,valuationAt:current.valuationAt?new Date(current.valuationAt).toISOString().slice(0,19):'',unitCost:current.unitCost??'',acceptSource:''}:
            {id:'',sourceKey:source.sourceKey,quantity:source.quantity,serviceId:'',unitCost:source.kind==='INVOICE_LINE'&&state.input.commercial?.currency==='USD'?'1':'',
              valuationAt:'',valuationSource:'',periodStart:source.periodStart,periodEnd:source.periodEnd,allocationNote:'',acceptSource:''};
          return;
        }
        if(action==='commercial-original-remove')selection.selections=selection.selections.filter(row=>row.id!==target.dataset.id);
        else if(action==='commercial-original-remove-review')selection.overlapReviews=selection.overlapReviews.filter(row=>JSON.stringify([row.workId,row.invoiceId,row.lineId])!==target.dataset.key);
        else throw new Error('Choose an original cost selection action.');
        recalculate(selectCohortOriginalCosts(state.input,selection));return;
      }
      if(action==='commercial-start'){requireEditable();const next=copy(state.input);next.commercial=seedCohortCommercialChoices(next);recalculate(next);return;}
      if(action.startsWith('commercial-remove-')){
        requireEditable();const next=copy(state.input),c=next.commercial;
        if(action==='commercial-remove-cost')c.costs=c.costs.filter(row=>row.id!==target.dataset.id);
        if(action==='commercial-remove-adjustment')c.adjustments=c.adjustments.filter(row=>row.id!==target.dataset.id);
        if(action==='commercial-remove-valuation'){const [network,asset]=JSON.parse(target.dataset.key);c.valuations=c.valuations.filter(row=>row.network!==network||row.asset!==asset);}
        if(action==='commercial-remove-allocation'){const [network,hash]=JSON.parse(target.dataset.key);c.transactionAllocations=c.transactionAllocations.filter(row=>row.network!==network||row.transactionHash.toLowerCase()!==hash);}
        recalculate(next);return;
      }
      if(action==='save'||action==='resume')return save();
      if(action==='open-source'){
        const meta=caseValue.sources.find(row=>row.id===state.selectedSource);if(!meta)throw new Error('Select a saved comparison.');
        openDocument(JSON.parse(await readSource(meta)),true);state.savedSourceId=meta.id;state.tab='report';state.notice='Reopened '+meta.filename+' from the original case.';return;
      }
      if(action==='import'){$('[data-cd-import]').click();return;}
      if(action==='json')return download(JSON.stringify(state.report,null,2)+'\n',clean(state.input.title)+'.json');
      if(action==='csv')return download(exportCohortDeliveryCsv(state.report),clean(state.input.title)+'.csv','text/csv');
      if(action==='html')return download(exportCohortDeliveryHtml(state.report),clean(state.input.title)+'.html','text/html');
      if(action==='input-json')return download(JSON.stringify(state.input,null,2)+'\n','cohort-delivery-input.json');
      if(action==='original-plan')return download(JSON.stringify(state.input.planDocument,null,2)+'\n','original-adoption-plan.json');
      if(action==='original-review')return download(JSON.stringify(state.input.review,null,2)+'\n','original-cohort-review.json');
      if(action==='pending-json'){const request=state.accepted||state.pending;if(request)download(decoded(request.payload.data.contentBase64),request.payload.data.filename);return;}
      if(action==='case-export'||action==='review-export'){
        const route=action==='case-export'?prefix+'/export.zip':prefix+'/cohort-reviews/'+encodeURIComponent(state.report.source.reviewId)+'/export.zip';
        const response=await saveApi(route,undefined,{download:true});download(await response.blob(),action==='case-export'?caseId+'.zip':state.report.source.reviewId+'.zip','application/zip');return;
      }
      if(action==='edit-intent'){state.editIntent=target.dataset.id;return;}
      if(action==='close-placement'){state.editIntent=null;return;}
      if(action==='remove-link'||action==='remove-assignment'){
        requireEditable();const next=copy(state.input);
        if(action==='remove-link'){next.links=next.links.filter(row=>!(row.kind===target.dataset.kind&&row.plannedId===target.dataset.id));next.assignments=[];state.notice='Restored original identity matching. Explicit intent placements were cleared for review against the changed associations.';}
        else next.assignments=next.assignments.filter(row=>row.intentId!==target.dataset.id);
        recalculate(next);return;
      }
    });
  });
  root.addEventListener('change',event=>{
    if(!event.target.matches('[data-cd-import]'))return;
    const file=event.target.files?.[0];if(!file)return;
    run(async()=>{requireEditable();if(file.size>MAX)throw new Error('Open a complete comparison within 8 MiB.');openDocument(JSON.parse(await file.text()));state.tab='report';state.notice='Opened the complete comparison and original documents from '+file.name+'.';});
  });
  render();
  async function openSavedWorkflow(selection){
    await ready;
    if(!available())throw new Error('Open this original comparison desk before selecting a source.');
    if(state.inflight||pending())throw new Error('Finish the retained comparison request before opening another source.');
    if(selection?.kind!=='cohort-delivery'||typeof selection.sourceId!=='string')
      throw new Error('Select an original saved cohort comparison.');
    if(selection.caseId!==undefined&&selection.caseId!==caseId||selection.expectedVersion!==undefined&&selection.expectedVersion!==caseValue.program.version)
      throw new Error('Refresh this original case before opening its saved comparison.');
    const meta=caseValue.sources.find(row=>row.id===selection.sourceId&&row.mediaType==='application/json'&&row.filename?.startsWith('sf47-cohort-delivery-'));
    if(!meta)throw new Error('The selected comparison source is absent from this original case.');
    state.error='';
    const work=(async()=>{
      const document=JSON.parse(await readSource(meta));
      if(!available())throw new Error('The comparison desk changed while its original source was opening.');
      openDocument(document,true);state.savedSourceId=meta.id;state.selectedSource=meta.id;
      state.tab='report';state.notice='Reopened '+meta.filename+'; earlier comparison drafts remain available.';
      return {outcome:'opened',caseId,kind:'cohort-delivery',sourceId:meta.id};
    })();
    state.inflight=work;controls();
    try{return await work;}
    catch(problem){state.error=problem.message||String(problem);throw problem;}
    finally{if(state.inflight===work)state.inflight=null;persist();if(available())render();}
  }
  const ready=(async()=>{
    if(state.inflight)await state.inflight;
    if(state.input&&!state.report){try{recalculate(state.input);}catch(error){state.error=error.message;}}
    if(state.accepted){try{await finishAccepted();}catch(error){state.error=error.message;}}
    if(available())render();
  })();
  return {root,ready,openSavedWorkflow,setHostBusy(value){hostBusy=!!value;controls();},updateCurrent(next){if(next?.program?.id!==caseId)throw new Error('Retain the original comparison case.');caseValue=next;if(available())render();},dispose(){persist();active=false;}};
}
