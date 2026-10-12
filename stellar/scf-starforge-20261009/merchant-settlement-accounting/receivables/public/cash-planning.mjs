// MIT. Operator cash planning inside the original receivables application.
import {cashDate,cashCurrency,cashLabel} from './cash-planning-display.mjs';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=cashLabel;
const button=(text,action,id='',extra='')=>'<button type="button" data-action="cash-plan-'+e(action)+'" data-id="'+e(id)+'" '+extra+'>'+e(text)+'</button>';
const input=(title,name,value,extra='')=>'<label>'+e(title)+'<input name="'+e(name)+'" value="'+e(value)+'" '+extra+'></label>';
const select=(title,name,values,chosen)=>'<label>'+e(title)+'<select name="'+e(name)+'">'+values.map(([value,text])=>
  '<option value="'+e(value)+'"'+(value===chosen?' selected':'')+'>'+e(text)+'</option>').join('')+'</select></label>';
const methods=new Set(['saveCashPlan','archiveCashPlan','reopenCashPlan']);
const copy=value=>structuredClone(value);
function plusDays(date,days){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function createCashPlanningUi(host){
  const {api,openDialog,mutate,saveBlob}=host;
  let list={plans:[]},draft=host.readSession('cashPlanningDraft'),review=null,error='',loadVersion=0,comparisonQuery=null;
  function persist(){host.saveSession('cashPlanningDraft',draft);}
  function fresh(){
    if(!list.workspaceId)throw new Error(error||'Refresh the original accounting workspace before planning.');
    const asOf=host.getAsOf();
    draft={workspaceId:list.workspaceId,id:'',version:0,plan:{title:'Receipt plan',owner:'Accounts receivable',note:'',
      asOf,through:plusDays(asOf,90),bucket:'WEEK',customerId:host.getCustomer()||null,pastDueDelayDays:0,
      futureDelayDays:0,usePromises:true,disputes:'SEPARATE',overrides:[]}};
    review=null;persist();
  }
  async function loadList(){
    const version=++loadVersion;
    try{const result=await api.cashPlans();if(version===loadVersion){list=result;error='';}}
    catch(cause){if(version===loadVersion){error=cause.message;list={plans:[]};}}
  }
  function matching(){
    const search=String(host.getSearch()||'').trim().toLowerCase();
    return list.plans.filter(row=>!search||[row.id,row.title,row.owner].some(value=>String(value).toLowerCase().includes(search)));
  }
  function totals(projection){
    return '<div class="table-wrap"><table><thead><tr><th>Currency</th><th class="num">Original due</th><th class="num">Within horizon</th>'+
      '<th class="num">After horizon</th><th class="num">Separated</th><th class="num">Of separated: awaiting review</th></tr></thead><tbody>'+
      projection.currencies.map(row=>'<tr><td>'+e(cashCurrency(row.currency))+'</td>'+
        ['amountDue','withinHorizon','afterHorizon','separated','reviewRequired'].map(key=>'<td class="num">'+e(row[key])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function projectionBody(projection,editable=false){
    return totals(projection)+projection.currencies.map(row=>'<section class="section"><h3>'+e(row.currency.code)+
      ' receipt periods</h3><div class="table-wrap"><table><thead><tr><th>From</th><th>Through</th><th class="num">Expected receipts</th><th class="num">Cumulative</th></tr></thead><tbody>'+
      row.periods.map(period=>'<tr><td>'+e(cashDate(period.from))+'</td><td>'+e(cashDate(period.through))+'</td><td class="num">'+e(period.amount)+
        '</td><td class="num">'+e(period.cumulative)+'</td></tr>').join('')+'</tbody></table></div></section>').join('')+
      (projection.customerFunds.length?'<section class="section"><h3>Existing customer funds</h3>'+
        '<p class="small-text muted">Review available receipts and invoice credits in the original account before planning new receipts. Their current saved allocation determines each invoice balance.</p>'+
        '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Currency</th><th class="num">Available receipts</th><th class="num">Invoice credits</th></tr></thead><tbody>'+
        projection.customerFunds.map(row=>'<tr><td>'+e(row.customerName)+'</td><td>'+e(cashCurrency(row.currency))+
          '</td><td class="num">'+e(row.availableReceipts)+'</td><td class="num">'+e(row.invoiceCredits)+'</td></tr>').join('')+'</tbody></table></div></section>':'')+
      '<section class="section"><h3>Original invoice allocation</h3><div class="table-wrap"><table><thead><tr><th>Invoice / customer</th><th>Original date / source</th>'+
      '<th>Expected date / position</th><th class="num">Amount</th><th>Reason</th></tr></thead><tbody>'+
      projection.lines.map(row=>'<tr><td>'+e(row.invoiceNumber)+'<span class="subline">'+e(row.customerName)+'</span></td>'+
        '<td>'+e(cashDate(row.originalDate))+'<span class="subline">'+e(label(row.source))+'</span></td><td>'+e(row.expectedDate?cashDate(row.expectedDate):'Separated')+
        '<span class="subline">'+e(label(row.position))+'</span></td><td class="num">'+e(row.currency.code+' '+row.amount)+
        '</td><td>'+e(row.reason)+'</td></tr>').join('')+'</tbody></table></div></section>'+
      (projection.sourceIssues.length?'<section class="section"><h3>Source changes and decisions</h3>'+
        projection.sourceIssues.map(row=>'<p class="notice">'+e(row.invoiceNumber+' · '+row.message)+
          (row.operatorOverride?' An explicit invoice assumption supplies its date or separation.':' Assign an expected date after reviewing the original invoice and schedule.')+'</p>').join('')+'</section>':'')+
      (editable?'<section class="section"><h3>Invoice assumptions</h3><p class="small-text muted">Give a whole invoice an explicit expected date or separate its balance, with the reason retained in this scenario.</p>'+
        '<div class="table-wrap"><table><thead><tr><th>Invoice / customer</th><th class="num">Original due</th><th>Current assumption</th><th></th></tr></thead><tbody>'+
        projection.invoices.map(row=>'<tr><td>'+e(row.number)+'<span class="subline">'+e(row.customerName)+'</span></td><td class="num">'+
          e(row.currency.code+' '+row.amountDue)+'</td><td>'+e(row.override?row.override.mode==='DATE'?cashDate(row.override.expectedDate):'Separated':'Original schedule and scenario rules')+
          '</td><td>'+button('Set assumption','assumption',row.id,'data-write')+'</td></tr>').join('')+'</tbody></table></div></section>':'')+
      (projection.inactiveOverrides.length?'<section class="section"><h3>Assumptions outside this view</h3>'+
        projection.inactiveOverrides.map(row=>'<p>'+e(row.invoiceId+' · '+row.reasonInView)+'</p>').join('')+'</section>':'');
  }
  function editor(){
    if(!draft)return '<p class="muted">Choose New plan, revise a saved edition or copy one to compare a different scenario.</p>';
    if(draft.workspaceId!==list.workspaceId)return '<p class="notice">The parked plan belongs to another accounting workspace. Choose New plan to start in this account.</p>';
    const p=draft.plan,saved=list.plans.find(row=>row.id===draft.id),stale=saved&&saved.version!==draft.version;
    const customers=[['','All customers'],...(host.getState()?.customers||[]).map(row=>[row.id,row.name||row.displayName||row.id])];
    return (stale?'<p class="notice">The parked assumptions use plan version '+draft.version+'; the current saved version is '+saved.version+
      '. Open the saved plan to review its newer edition.</p>'+button('Load current saved plan','revise',draft.id,'data-write'):'')+
      '<form id="cash-plan-form"><div class="form-grid">'+input('Plan title','title',p.title,'required maxlength="300"')+
      input('Owner','owner',p.owner,'required maxlength="160"')+input('Account date','asOf',p.asOf,'type="date" required')+
      input('Through','through',p.through,'type="date" required')+
      select('Receipt periods','bucket',[['DAY','Daily'],['WEEK','Weekly from account date'],['MONTH','Calendar months']],p.bucket)+
      select('Customer','customerId',customers,p.customerId||'')+
      input('Past-due receipts: days after account date','pastDueDelayDays',p.pastDueDelayDays,'type="number" min="0" max="3660" required')+
      input('Future receipts: days after original date','futureDelayDays',p.futureDelayDays,'type="number" min="0" max="3660" required')+
      select('Use recorded open payment promises','usePromises',[['true','Yes'],['false','No']],String(p.usePromises))+
      select('Open disputed amounts','disputes',[['SEPARATE','Separate from expected receipts'],['INCLUDE','Include in this scenario']],p.disputes)+
      '</div><label>Planning note<textarea name="note" rows="3" maxlength="6000">'+e(p.note)+'</textarea></label>'+
      '<p class="small-text muted">Expected dates are the assumptions for this saved scenario. The preview shows each original invoice balance, installment or promise and its allocation.</p>'+
      '<div class="dialog-actions"><button type="submit" class="primary" data-write>Recalculate and review</button></div></form>'+
      (p.overrides.length?'<section class="section"><h3>Retained invoice assumptions</h3>'+p.overrides.map(row=>
        '<p>'+e(row.invoiceId+' · '+(row.mode==='DATE'?cashDate(row.expectedDate):'Separated')+' · '+row.reason)+' '+
        button('Edit','assumption',row.invoiceId,'data-write')+' '+button('Use source dates','remove-assumption',row.invoiceId,'data-write')+'</p>').join('')+'</section>':'')+
      (review?'<section class="section"><div class="row between"><h3>Reviewed receipt plan</h3>'+
        button('Save reviewed edition','save',draft.id,'data-write')+'</div><p id="cash-plan-review-state" class="small-text muted">'+
        'Original accounting revision '+review.revision+' · '+e(cashDate(review.plan.asOf))+' through '+e(cashDate(review.plan.through))+
        '. Saving retains this complete edition.</p>'+projectionBody(review.projection,true)+'</section>':'');
  }
  function render(){
    const rows=matching();
    return '<section class="panel"><div class="panel-head"><div><h2>Cash receipt planning</h2>'+
      '<p class="small-text muted">Retain and compare collection scenarios from the original invoice, installment and customer follow-up records.</p></div>'+
      button('New plan','new','','data-write')+'</div><div class="panel-body">'+(error?'<p class="notice error">'+e(error)+'</p>':'')+editor()+'</div></section>'+
      '<section class="panel"><div class="panel-head"><h2>Saved plans and editions</h2></div>'+
      (rows.length?'<div class="table-wrap"><table><thead><tr><th>Plan / owner</th><th>Account date / horizon</th><th>Status / editions</th><th></th></tr></thead><tbody>'+
        rows.map(row=>'<tr><td>'+button(row.title,'open',row.id,'class="link"')+'<span class="subline">'+e(row.owner)+
          '</span></td><td>'+e(cashDate(row.asOf))+'<span class="subline">Through '+e(cashDate(row.through))+'</span></td><td>'+
          e(label(row.status))+'<span class="subline">'+row.editionCount+' retained editions</span></td><td>'+
          button('Copy scenario','copy',row.id,'data-write')+'</td></tr>').join('')+'</tbody></table></div>':
        '<div class="panel-body"><p>No saved plans match this view.</p></div>')+'</section>'+
      (list.plans.length?'<section class="panel"><div class="panel-head"><h2>Compare saved scenarios</h2></div><div class="panel-body">'+
        '<form id="cash-plan-compare-form"><div class="form-grid">'+
        select('Left plan — latest saved edition','leftId',list.plans.map(row=>[row.id,row.title+' · '+cashDate(row.asOf)]),list.plans[0]?.id)+
        select('Right plan — latest saved edition','rightId',list.plans.map(row=>[row.id,row.title+' · '+cashDate(row.asOf)]),list.plans[1]?.id||list.plans[0]?.id)+
        '</div><div class="dialog-actions"><button type="submit">Compare editions</button></div></form></div></section>':'');
  }
  function remember(form){
    if(form?.id!=='cash-plan-form'||!draft)return;
    const value=Object.fromEntries(new FormData(form));
    const plan={...draft.plan,title:value.title,owner:value.owner,note:value.note,asOf:value.asOf,through:value.through,
      bucket:value.bucket,customerId:value.customerId||null,pastDueDelayDays:Number(value.pastDueDelayDays),
      futureDelayDays:Number(value.futureDelayDays),usePromises:value.usePromises==='true',disputes:value.disputes};
    if(JSON.stringify(plan)!==JSON.stringify(draft.plan)){
      draft.plan=plan;review=null;persist();
      const save=document.querySelector('[data-action="cash-plan-save"]');if(save)save.disabled=true;
      const state=document.querySelector('#cash-plan-review-state');if(state)state.textContent='Assumptions edited. Recalculate to review and save the updated plan.';
    }
  }
  async function recalculate(){
    if(!draft||draft.workspaceId!==list.workspaceId)throw new Error('Open this plan in its original accounting workspace.');
    const form=document.querySelector('#cash-plan-form');if(form)remember(form);
    const snapshot=copy(draft),version=JSON.stringify(snapshot);
    host.setBusy(true);
    try{
      const result=await api.previewCashPlan({workspaceId:snapshot.workspaceId,plan:snapshot.plan});
      if(JSON.stringify(draft)!==version)return;
      review=result;host.render();
    }finally{host.setBusy(false);}
  }
  async function openSaved(id,editionId){
    const detail=await api.cashPlan(id,{editionId}),row=detail.cashPlan,edition=detail.edition;
    const previous=detail.editions.find(item=>item.number===edition.number-1);
    openDialog(edition.plan.title,'<p>'+e(edition.plan.owner)+' · Edition '+edition.number+' · Saved '+e(cashDate(edition.createdAt))+
      ' by '+e(edition.actor)+'</p><p>Original account date '+e(cashDate(edition.plan.asOf))+' through '+e(cashDate(edition.plan.through))+
      ' · Source revision '+edition.sourceRevision+'</p><div class="row wrap">'+
      (row.status==='ACTIVE'?button('Revise latest edition','revise',id,'data-write'):button('Reopen plan','status',id,'data-status="ACTIVE" data-write'))+
      button('Copy this edition','copy',id,'data-edition="'+e(edition.id)+'" data-write')+
      (row.status==='ACTIVE'?button('Archive plan','status',id,'data-status="ARCHIVED" data-write'):'')+
      ['plan.json','plan.csv','plan.html','manifest.json'].map(name=>button(name,'download',id,'data-name="'+name+'" data-edition="'+e(edition.id)+'"')).join('')+
      '</div><label>Retained edition<select data-cash-edition="'+e(id)+'">'+detail.editions.map(item=>'<option value="'+e(item.id)+'"'+
        (item.id===edition.id?' selected':'')+'>Edition '+item.number+' · '+e(cashDate(item.asOf))+' · '+e(cashDate(item.createdAt))+'</option>').join('')+'</select></label>'+
      (previous?button('Compare to previous edition','compare-previous',id,'data-left="'+e(previous.id)+'" data-right="'+e(edition.id)+'"'):'')+
      '<p class="preline">'+e(edition.plan.note)+'</p>'+projectionBody(edition.projection)+
      '<section class="section"><h3>Saved plan history</h3>'+[...detail.history].reverse().map(item=>'<p>'+e(cashDate(item.at)+' · '+label(item.kind)+' · '+item.actor)+
        (item.note?'<span class="subline preline">'+e(item.note)+'</span>':'')+'</p>').join('')+'</section>');
  }
  async function edit(id,copyEdition=false,editionId){
    const detail=await api.cashPlan(id,{editionId:copyEdition?editionId:undefined});
    if(!copyEdition&&detail.cashPlan.status!=='ACTIVE')throw new Error('Reopen this plan to save a new edition.');
    draft={workspaceId:detail.workspaceId,id:copyEdition?'':id,version:copyEdition?0:detail.cashPlan.version,plan:copy(detail.edition.plan)};
    if(copyEdition)draft.plan.title=(draft.plan.title+' copy').slice(0,300);
    review=null;persist();host.closeDialog();host.render();
  }
  function assumption(id){
    if(!draft)throw new Error('Open the scenario assumptions first.');
    const original=draft.plan.overrides.find(row=>row.invoiceId===id),invoice=review?.projection.invoices.find(row=>row.id===id);
    const source=(host.getState()?.invoices||[]).find(row=>row.id===id);
    openDialog('Invoice receipt assumption','<form id="cash-plan-assumption-form" data-id="'+e(id)+'"><p>'+
      e(invoice?.number||source?.number||id)+' · '+e(invoice?.customerName||source?.customerName||'')+'</p>'+
      '<p class="small-text muted">This assumption covers the full remaining invoice balance, including an open disputed amount.</p>'+
      select('Assumption','mode',[['DATE','Receive the remaining balance on an explicit date'],['EXCLUDE','Separate this invoice from expected receipts']],original?.mode||'DATE')+
      input('Expected receipt date','expectedDate',original?.expectedDate||draft.plan.asOf,'type="date"')+
      '<label>Reason<textarea name="reason" rows="4" maxlength="1500" required>'+e(original?.reason||'')+'</textarea></label>'+
      '<div class="dialog-actions"><button type="button" data-action="close-dialog">Close</button><button type="submit" data-write>Retain assumption</button></div></form>');
  }
  async function compare(query){
    const result=await api.compareCashPlans(query);comparisonQuery={...query,leftEditionId:result.left.id,rightEditionId:result.right.id};
    openDialog('Saved collection plan comparison','<p>Left: '+e(result.left.plan.title)+' · Edition '+result.left.number+' · Account date '+
      e(cashDate(result.left.plan.asOf))+' · Revision '+result.left.sourceRevision+'</p><p>Right: '+e(result.right.plan.title)+' · Edition '+result.right.number+
      ' · Account date '+e(cashDate(result.right.plan.asOf))+' · Revision '+result.right.sourceRevision+'</p><p class="small-text muted">'+
      'Changes are right minus left; each edition retains its own account date, horizon and assumptions.</p><div class="row">'+
      button('Download JSON','comparison-file','','data-name="comparison.json"')+button('Download dated CSV','comparison-file','','data-name="comparison.csv"')+'</div>'+
      result.currencies.map(row=>'<section class="section"><h3>'+e(cashCurrency(row.currency))+'</h3>'+
        '<div class="table-wrap"><table><thead><tr><th>Amount</th><th class="num">Left</th><th class="num">Right</th><th class="num">Change</th></tr></thead><tbody>'+
        ['amountDue','withinHorizon','afterHorizon','separated','reviewRequired'].map(key=>'<tr><td>'+
          e(({amountDue:'Original due',withinHorizon:'Within horizon',afterHorizon:'After horizon',separated:'Separated',reviewRequired:'Of separated: awaiting review'})[key])+
          '</td><td class="num">'+e(row[key].left)+'</td><td class="num">'+e(row[key].right)+'</td><td class="num">'+e(row[key].change)+'</td></tr>').join('')+
        '</tbody></table></div></section>').join('')+
      '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Currency</th><th class="num">Left receipts</th><th class="num">Right receipts</th><th class="num">Change</th></tr></thead><tbody>'+
        result.dates.map(row=>'<tr><td>'+e(cashDate(row.date))+'</td><td>'+e(cashCurrency(row.currency))+'</td><td class="num">'+e(row.left)+
          '</td><td class="num">'+e(row.right)+'</td><td class="num">'+e(row.change)+'</td></tr>').join('')+'</tbody></table></div>');
  }
  async function submit(form,values){
    if(!form.id.startsWith('cash-plan-'))return false;
    if(form.id==='cash-plan-form')await recalculate();
    else if(form.id==='cash-plan-assumption-form'){
      if(host.isLocked())throw new Error('Complete the retained account operation before changing assumptions.');
      const row={invoiceId:form.dataset.id,mode:values.mode,expectedDate:values.mode==='DATE'?values.expectedDate:null,reason:values.reason};
      draft.plan.overrides=[...draft.plan.overrides.filter(item=>item.invoiceId!==row.invoiceId),row];
      review=null;persist();host.closeDialog();host.render();
    }else if(form.id==='cash-plan-compare-form')await compare({leftId:values.leftId,rightId:values.rightId});
    else if(form.id==='cash-plan-status-form'){
      await mutate(form.dataset.status==='ARCHIVED'?'archiveCashPlan':'reopenCashPlan',[form.dataset.id,
        {workspaceId:form.dataset.workspace,expectedVersion:Number(form.dataset.version),note:values.note}],
        form.dataset.status==='ARCHIVED'?'Archive receipt plan':'Reopen receipt plan');
    }else return false;
    return true;
  }
  async function click(control){
    const action=control.dataset.action;if(!action?.startsWith('cash-plan-'))return false;
    const readActions=['cash-plan-open','cash-plan-download','cash-plan-compare-previous','cash-plan-comparison-file'];
    if(host.isLocked()&&!readActions.includes(action))throw new Error('Complete the retained account operation before changing planning assumptions.');
    const id=control.dataset.id;
    if(action==='cash-plan-new'){fresh();host.render();}
    else if(action==='cash-plan-open')await openSaved(id,control.dataset.edition);
    else if(action==='cash-plan-revise')await edit(id);
    else if(action==='cash-plan-copy')await edit(id,true,control.dataset.edition);
    else if(action==='cash-plan-assumption')assumption(id);
    else if(action==='cash-plan-remove-assumption'){draft.plan.overrides=draft.plan.overrides.filter(row=>row.invoiceId!==id);review=null;persist();host.render();}
    else if(action==='cash-plan-save'){
      const form=document.querySelector('#cash-plan-form');if(form)remember(form);
      if(!review)throw new Error('Recalculate and review the current assumptions before saving.');
      await mutate('saveCashPlan',[{workspaceId:draft.workspaceId,...(draft.id?{id:draft.id,expectedVersion:draft.version}:{}),
        plan:review.plan,reviewSha256:review.reviewSha256}],'Save reviewed receipt plan',{revision:review.revision});
    }else if(action==='cash-plan-status'){
      const detail=await api.cashPlan(id);
      openDialog(control.dataset.status==='ARCHIVED'?'Archive receipt plan':'Reopen receipt plan',
        '<form id="cash-plan-status-form" data-id="'+e(id)+'" data-status="'+e(control.dataset.status)+'" data-workspace="'+e(detail.workspaceId)+
        '" data-version="'+detail.cashPlan.version+'"><p>'+e(detail.cashPlan.title)+'</p><label>Reason<textarea name="note" rows="3" maxlength="1500" required></textarea></label>'+
        '<div class="dialog-actions"><button type="button" data-action="close-dialog">Close</button><button type="submit" data-write>Retain status change</button></div></form>');
    }else if(action==='cash-plan-download'){
      const response=await api.cashPlanFile(id,control.dataset.name,{editionId:control.dataset.edition});
      saveBlob(await response.blob(),control.dataset.name);
    }else if(action==='cash-plan-compare-previous')await compare({leftId:id,leftEditionId:control.dataset.left,rightId:id,rightEditionId:control.dataset.right});
    else if(action==='cash-plan-comparison-file'){
      const response=await api.cashPlanComparisonFile(control.dataset.name,comparisonQuery);saveBlob(await response.blob(),control.dataset.name);
    }
    return true;
  }
  return {methods,render,loadList,submit,click,
    input(target){remember(target.closest('#cash-plan-form'));},
    async change(target){if(target.dataset.cashEdition)await openSaved(target.dataset.cashEdition,target.value);else remember(target.closest('#cash-plan-form'));},
    async afterMutation(result,operation){
      if(!methods.has(operation.method))return;
      if(operation.method==='saveCashPlan'){draft=null;review=null;persist();host.render();}
      if(result.cashPlan?.id)await openSaved(result.cashPlan.id,result.cashPlanEdition?.id);
    }};
}
