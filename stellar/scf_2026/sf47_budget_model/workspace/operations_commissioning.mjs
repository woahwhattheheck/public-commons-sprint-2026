// Commissioning stays in the original Installation draft, save and history.
const SCHEMA='stellar-forge.sf47-customer-commissioning.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const reviewKey=(kind,id)=>kind+':'+(id??'budget');
const money=value=>value===null||value===undefined?'Unentered':String(value);
const pretty=value=>'<pre>'+esc(JSON.stringify(value,null,2))+'</pre>';
function button(label,name,attrs='',disabled=false){
  return '<button type="button" data-installation-action="commissioning-'+name+'" '+attrs+(disabled?' disabled data-installation-fixed="true"':'')+'>'+esc(label)+'</button>';
}
function choices(values,selected){
  return values.map(([id,label])=>'<option value="'+esc(id)+'"'+
    ((Array.isArray(selected)?selected.includes(id):String(selected??'')===String(id))?' selected':'')+'>'+esc(label)+'</option>').join('');
}
function field(label,path,value,{options,multiple=false,area=false,wide=false,integer=false,help='',ui=false,max=8000}={}){
  const attr=(ui?'data-commissioning-ui':'data-commissioning-field')+'="'+esc(path)+'"';
  const input=options?'<select '+attr+(multiple?' multiple size="4"':'')+'>'+choices(options,value)+'</select>':
    area?'<textarea '+attr+' maxlength="'+max+'" rows="3">'+esc(value)+'</textarea>':
    '<input '+attr+' value="'+esc(value)+'"'+(integer?' type="number" min="0" step="1"':' type="text" maxlength="'+max+'"')+'>';
  return '<label'+(wide?' class="commissioning-wide"':'')+'><span>'+esc(label)+'</span>'+input+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
function table(headings,rows){
  return '<div class="commissioning-table"><table><thead><tr>'+headings.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+
    '</tr></thead><tbody>'+(rows.length?rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join(''):
    '<tr><td colspan="'+headings.length+'">No selected rows.</td></tr>')+'</tbody></table></div>';
}
function stylesheet(){
  if(document.querySelector('link[data-commissioning-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_commissioning.css';
  link.dataset.commissioningStyle='true';document.head.append(link);
}
function assign(target,path,value){
  const bits=path.split('.');let row=target;
  for(const bit of bits.slice(0,-1)){if(row==null)return;row=row[bit];}
  if(row!=null)row[bits.at(-1)]=value;
}
function reviewStatus(review){
  if(!review)return 'Not prepared';
  return title(review.state)+(review.status?' · '+title(review.status):'')+
    (review.effectiveApproval?' · effective for this basis':'');
}
function pageRows(group,rows,ui){
  const size=5,pages=Math.max(1,Math.ceil(rows.length/size)),page=Math.min(Math.max(0,Number(ui[group+'Page'])||0),pages-1);
  ui[group+'Page']=page;
  return {rows:rows.slice(page*size,(page+1)*size).map((row,index)=>({row,index:page*size+index})),
    html:'<div class="commissioning-actions"><span>'+rows.length+' retained rows · page '+(page+1)+' of '+pages+'</span>'+
      button('Previous','page','data-commissioning-group="'+group+'" data-commissioning-page="'+(page-1)+'"',page===0)+
      button('Next','page','data-commissioning-group="'+group+'" data-commissioning-page="'+(page+1)+'"',page+1>=pages)+'</div>'};
}
function factsFor(value,ui){
  const facts=new Map();
  for(const row of value?.uses||[])for(const fact of row.facts||[])facts.set(fact.cycleId,fact);
  for(const fact of ui.inventory?.cycles||[])facts.set(fact.cycleId,fact);
  return [...facts.values()];
}
function fileChoices(row){
  const values=new Map();
  for(const fact of row.facts||[])for(const file of fact.files||[]){
    const item={cycleId:fact.cycleId,...file},key=JSON.stringify([item.cycleId,item.deliveryId,item.path]);
    values.set(key,item);
  }
  for(const item of row.outputFiles||[]){
    const key=JSON.stringify([item.cycleId,item.deliveryId,item.path]);
    if(!values.has(key))values.set(key,item);
  }
  return [...values.values()];
}
function fileEquals(a,b){return ['cycleId','deliveryId','path','bytes','sha256'].every(key=>a[key]===b[key]);}
function currentPreparation(documentValue,ui,version){
  return !!ui.report&&same(documentValue,ui.preparedDocument)&&version===ui.preparedVersion;
}
function decisionFields(kind,id,review,ui,ready,findings=[]){
  const key=reviewKey(kind,id),draft=(ui.decisions??={})[key]??={state:'APPROVED',note:''};
  return '<section class="commissioning-decision" aria-label="'+esc(title(kind))+' review">'+
    '<p><strong>'+esc(reviewStatus(review))+'</strong>'+
      (review?.actor?' · '+esc(review.actor)+' · '+esc(review.observedAt):'')+'</p>'+
    (review?.note?'<p>'+esc(review.note)+'</p>':'')+
    (findings.length?'<ul>'+findings.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>':'')+
    '<div class="commissioning-fields"><label><span>Decision</span><select data-commissioning-decision="'+esc(key)+'" data-decision-field="state">'+
      choices([['APPROVED',kind==='OUTPUT'?'Accept this useful output':'Approve this basis'],['CHANGES_REQUIRED','Changes required']],draft.state)+
      '</select></label><label class="commissioning-wide"><span>Decision reason</span><textarea rows="2" maxlength="8000" data-commissioning-decision="'+esc(key)+'" data-decision-field="note">'+esc(draft.note)+'</textarea></label></div>'+
    '<div class="commissioning-actions"><label class="commissioning-check"><input type="checkbox" data-commissioning-review-select="'+esc(key)+'"'+
      (ui.selectedReviews?.[key]?' checked':'')+'>Include in explicit review batch</label>'+
    button(kind==='OUTPUT'?'Record output decision':'Record '+title(kind)+' decision','review','data-commissioning-kind="'+kind+'" data-commissioning-id="'+esc(id??'budget')+'"')+'</div>'+
    (!ready?'<small>The prepared basis has open findings. A changes-required decision can retain them.</small>':'')+'</section>';
}

export function captureCommissioning(root,documentValue,ui={}){
  const value=documentValue.commissioning;
  if(value)for(const input of root.querySelectorAll('[data-commissioning-field]')){
    const path=input.dataset.commissioningField;
    let selected=input.multiple?[...input.selectedOptions].map(row=>row.value):input.value;
    if(/\.units$/.test(path))selected=selected===''?null:Number(selected);
    else if(path==='aggregateBudgetAtomic'||/\.(priceAtomic|budgetAtomic)$/.test(path))selected=selected===''?null:selected;
    assign(value,path,selected);
  }
  for(const input of root.querySelectorAll('[data-commissioning-ui]'))ui[input.dataset.commissioningUi]=input.value;
  for(const input of root.querySelectorAll('[data-commissioning-decision]')){
    const row=(ui.decisions??={})[input.dataset.commissioningDecision]??={state:'APPROVED',note:''};
    row[input.dataset.decisionField]=input.value;
  }
  for(const input of root.querySelectorAll('[data-commissioning-review-select]'))(ui.selectedReviews??={})[input.dataset.commissioningReviewSelect]=input.checked;
  if(!value)return;
  for(const element of root.querySelectorAll('[data-commissioning-output-group]')){
    const index=Number(element.dataset.commissioningOutputGroup),row=value.uses[index];
    if(!row)continue;
    const available=fileChoices(row);
    row.outputFiles=[...element.querySelectorAll('[data-commissioning-output]:checked')].map(input=>available[Number(input.dataset.commissioningOutput)]).filter(Boolean).map(copy);
  }
  for(const input of root.querySelectorAll('[data-commissioning-call]')){
    const [useIndex,linkIndex]=input.dataset.commissioningCall.split(':').map(Number),row=value.uses[useIndex]?.receiptLinks[linkIndex];
    if(row){const selected=input.value?JSON.parse(input.value):['',''];row.cycleId=selected[0];row.callId=selected[1];}
  }
}

export function commissioningFields(documentValue,context,ui={}){
  stylesheet();
  const value=documentValue.commissioning,calendar=documentValue.useCalendar;
  let html='<fieldset class="commissioning-editor" data-commissioning-editor><legend>Customer commissioning and receiving</legend>'+
    '<p>Join the original dated customer tasks to their retained Console cycles, price selections and useful outputs. The original Installation save retains the complete decision history.</p>';
  if(!value)return html+(!calendar?'<p>Create the customer-use calendar above, then select the original workflow handover through the Installation source intake.</p>':'')+
    button('Prepare customer commissioning','refresh','',!calendar)+'</fieldset>';
  const prepared=currentPreparation(documentValue,ui,context.program.version),view=ui.report;
  const sources=context.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]);
  const entryMap=new Map((calendar?.entries||[]).map(row=>[row.id,row])),fundMap=new Map((calendar?.settlements||[]).map(row=>[row.id,row]));
  const taskMap=new Map((calendar?.tasks||[]).map(row=>[row.id,row])),deps=new Map(context.records.deployments.map(row=>[row.id,row]));
  const inventory=factsFor(value,ui),selectedCycleIds=new Set(documentValue.workflowPeriods?.periods?.map(row=>row.cycleId)||[]);
  const cycleOptions=inventory.filter(row=>selectedCycleIds.has(row.cycleId)).map(row=>[row.cycleId,
    row.seriesName+' · '+row.period.start+' — '+row.period.end+' · '+row.state+' · '+row.cycleId]);
  for(const id of selectedCycleIds)if(!cycleOptions.some(row=>row[0]===id))cycleOptions.push([id,id+' · prepare to read original facts']);
  html+='<div class="commissioning-actions">'+button('Refresh exact source and review bases','refresh')+
    button('Remove commissioning from draft','disable')+'</div>'+
    '<p class="commissioning-'+(prepared?'current':'attention')+'">'+
    (prepared?'The displayed report matches this exact draft and current operating-case version.':
      'Refresh after editing. Earlier prepared review details are retained for comparison and will not authorize a changed draft.')+'</p>'+
    '<div class="commissioning-fields">'+
    field('Commissioning scope and changes','note',value.note,{area:true,wide:true,max:12000})+
    field('Aggregate budget in original atomic units','aggregateBudgetAtomic',value.aggregateBudgetAtomic,{help:'Exact whole-number text. Keep the selected Installation network, asset and recipient.'})+
    field('Buyer budget authority','authority',value.authority,{area:true,wide:true})+
    field('Commissioning and budget source files','sourceIds',value.sourceIds,{options:sources,multiple:true,wide:true})+'</div>'+
    '<p>Original payer: <strong>'+esc(documentValue.workorder.payer||'Unentered')+'</strong> · merchant: '+esc(deps.get(documentValue.merchantDeploymentId)?.name||'Unselected')+
    ' · payment: '+esc(documentValue.payment.network||'Unentered')+' / '+esc(documentValue.payment.asset||'Unentered')+' · recipient '+esc(documentValue.payment.recipient||'Unentered')+'</p>';
  const fundingPage=pageRows('funding',value.funding,ui);
  html+='<h4>Original funding groups and priced units</h4><p>A prepaid group is reviewed once even when it supports several later uses. Native receipts stay in their original calendar groups.</p>'+fundingPage.html;
  for(const {row,index} of fundingPage.rows){
    const group=fundMap.get(row.fundingId),task=taskMap.get(group?.taskId),basis=view?.funding.find(item=>item.fundingId===row.fundingId),path='funding.'+index+'.';
    html+='<details class="commissioning-row" open><summary>'+esc(task?.name||row.fundingId)+' · '+esc(group?.date||'Removed from calendar')+
      ' · '+esc(title(group?.kind||'unbound'))+'</summary><p>'+esc(row.fundingId)+' · '+esc(deps.get(group?.buyerDeploymentId)?.name||group?.buyerDeploymentId||'Unbound buyer')+'</p>'+
      '<div class="commissioning-fields">'+field('Number of complete priced units',path+'units',row.units,{integer:true})+
      field('Original unit price, atomic',path+'priceAtomic',row.priceAtomic)+
      field('Funding-group budget, atomic',path+'budgetAtomic',row.budgetAtomic)+
      field('Price and budget source files',path+'sourceIds',row.sourceIds,{options:sources,multiple:true,wide:true})+
      field('Complete priced unit and selection basis',path+'note',row.note,{area:true,wide:true})+'</div>'+
      '<p>Original task unit: '+esc(task?.pricedUnit||'Unentered')+'</p>'+
      (basis?'<p>Expected '+esc(money(basis.expectedAtomic))+' · recorded settled '+esc(money(basis.recordedSettledAtomic))+' atomic units.</p>'+
        (basis.issues?.length?'<ul>'+basis.issues.map(item=>'<li>'+esc(item.message)+'</li>').join('')+'</ul>':'')+
        table(['Original purchase','Native settlement / output','Recorded amount / fees','Original intent'],basis.receipts.map(receipt=>[
          esc(receipt.id),esc(receipt.settlementStatus)+' / '+esc(receipt.outputStatus),esc(receipt.amountStroops)+' / '+esc(receipt.feesStroops??'unknown'),esc(receipt.intentId||receipt.transactionHash)])):'')+
      decisionFields('FUNDING',row.fundingId,basis?.review||row.review,ui,prepared&&basis?.canApprove,basis?.reviewFindings||[])+
      button('Remove this commissioning price row','remove-funding','data-commissioning-index="'+index+'"')+'</details>';
  }
  html+='<h4>Active funding-group aggregate</h4>'+
    (view?'<p>Expected '+esc(money(view.budget.expectedAtomic))+' · selected group caps '+esc(money(view.budget.selectedGroupBudgetsAtomic))+
      ' · aggregate cap '+esc(money(value.aggregateBudgetAtomic))+' · original settled amount for active groups '+esc(money(view.budget.recordedSettledAtomic))+' atomic units.</p>':'')+
    decisionFields('BUDGET','budget',view?.budget.review||value.budgetReview,ui,prepared&&view?.budget.canApprove,view?.budget.findings||[]);
  const usePage=pageRows('uses',value.uses,ui);
  html+='<h4>Dated use, original request and full result</h4>'+usePage.html;
  for(const {row,index} of usePage.rows){
    const entry=entryMap.get(row.entryId),task=taskMap.get(entry?.taskId),basis=view?.uses.find(item=>item.entryId===row.entryId),path='uses.'+index+'.';
    const facts=row.facts||[],availableFiles=fileChoices(row);
    const receiptIds=new Set((entry?.fundingIds||[]).flatMap(id=>fundMap.get(id)?.purchaseIds||[]));
    const purchaseOptions=[['','Select an original received purchase'],...context.records.purchases.filter(item=>receiptIds.has(item.id)).map(item=>[item.id,
      (item.intentId||item.operationId||item.id)+' · '+item.settlementStatus+'/'+item.outputStatus+' · '+item.amountStroops+' '+item.asset])];
    const callOptions=[['','Select an original cycle and retained call'],...facts.flatMap(fact=>(fact.calls||[]).map(call=>[
      JSON.stringify([fact.cycleId,call.id]),fact.period.start+' · '+fact.seriesName+' · '+call.id+' · '+call.state]))];
    const optionsWithMissing=[...cycleOptions];
    for(const id of row.cycleIds)if(!optionsWithMissing.some(item=>item[0]===id))optionsWithMissing.push([id,id+' · absent from selected source']);
    html+='<details class="commissioning-row" open><summary>'+esc(entry?.date||'Removed from calendar')+' · '+esc(task?.name||row.entryId)+' · '+esc(title(entry?.mode||'unbound'))+'</summary>'+
      '<p>'+esc(row.entryId)+' · '+esc(deps.get(entry?.buyerDeploymentId)?.name||'Unbound buyer')+' · '+esc(title(entry?.state||'unbound'))+'</p>'+
      '<dl><dt>Complete original request</dt><dd>'+esc(task?.request||'Unentered')+'</dd><dt>Useful output</dt><dd>'+esc(task?.completeOutput||'Unentered')+
      '</dd><dt>Reason for a later result</dt><dd>'+esc(task?.repeatTrigger||'Unentered')+'</dd></dl><div class="commissioning-fields">'+
      field('Original Console cycles for this complete task',path+'cycleIds',row.cycleIds,{options:optionsWithMissing,multiple:true,wide:true,
        help:'An explicit correspondence. Select cycles, then refresh their exact retained source facts.'})+
      field('Task-to-cycle and result correspondence',path+'note',row.note,{area:true,wide:true})+
      field('Correspondence source files',path+'sourceIds',row.sourceIds,{options:sources,multiple:true,wide:true})+
      field('Useful-output evidence',path+'outputEvidence',row.outputEvidence,{options:[['UNSELECTED','Unselected'],['NATIVE_RESULTS','Selected complete native results'],['SELECTED_FILES','Selected original customer files']]})+'</div>'+
      table(['Original cycle / request period','Source edition / due date','Native outcome','Plan / result identity'],facts.map(fact=>[
        esc(fact.cycleId)+'<br>'+esc(fact.period.start)+' — '+esc(fact.period.end),
        esc(fact.sourceEdition)+'<br>'+esc(fact.dueDate),esc(fact.state)+' · '+esc(fact.completedAt??'No completion')+'<br>'+esc(fact.steps.filter(item=>item.state==='COMPLETE').length)+' / '+fact.steps.length+' complete steps',
        '<code>'+esc(fact.planSha256)+'</code><br><code>'+esc(fact.resultSha256)+'</code>']))+
      decisionFields('PLAN',row.entryId,basis?.planReview||row.planReview,ui,prepared&&basis?.canApprovePlan,basis?.planFindings||[])+
      '<h5>Exact retained output selection</h5><div class="commissioning-output" data-commissioning-output-group="'+index+'">'+
      (availableFiles.length?availableFiles.map((file,fileIndex)=>'<label class="commissioning-check"><input type="checkbox" data-commissioning-output="'+fileIndex+'"'+
        (row.outputFiles.some(item=>fileEquals(item,file))?' checked':'')+'><span>'+esc(file.path)+' · '+file.bytes+' bytes<small>'+esc(file.cycleId)+' · '+esc(file.deliveryId)+
        '</small><code>'+esc(file.sha256)+'</code></span></label>').join(''):'<p>The selected source has no customer files. Native result evidence can still be selected explicitly.</p>')+'</div>'+
      '<h5>Original native call and received purchase correspondence</h5><p>This mapping records an operator’s source selection. Transfer state remains in the original received purchase.</p>';
    for(let linkIndex=0;linkIndex<row.receiptLinks.length;linkIndex++){
      const link=row.receiptLinks[linkIndex],linkPath=path+'receiptLinks.'+linkIndex+'.';
      const selectedCall=link.cycleId&&link.callId?JSON.stringify([link.cycleId,link.callId]):'';
      const calls=[...callOptions];if(selectedCall&&!calls.some(item=>item[0]===selectedCall))calls.push([selectedCall,'Previously selected call is absent: '+link.callId]);
      const receiptOptions=[...purchaseOptions];if(link.purchaseId&&!receiptOptions.some(item=>item[0]===link.purchaseId))receiptOptions.push([link.purchaseId,link.purchaseId+' · no longer in this funding group']);
      html+='<div class="commissioning-link"><div class="commissioning-fields">'+
        field('Original received purchase',linkPath+'purchaseId',link.purchaseId,{options:receiptOptions,wide:true})+
        '<label class="commissioning-wide"><span>Original cycle and native call</span><select data-commissioning-call="'+index+':'+linkIndex+'">'+choices(calls,selectedCall)+'</select></label>'+
        field('Correspondence reason',linkPath+'note',link.note,{area:true,wide:true})+'</div>'+
        button('Remove this draft correspondence','remove-receipt','data-commissioning-index="'+index+'" data-commissioning-link="'+linkIndex+'"')+'</div>';
    }
    html+=button('Add explicit receipt correspondence','add-receipt','data-commissioning-index="'+index+'"')+
      decisionFields('OUTPUT',row.entryId,basis?.receivingReview||row.receivingReview,ui,prepared&&basis?.canAcceptOutput,basis?.receivingFindings||[])+
      button('Remove this commissioning use row','remove-use','data-commissioning-index="'+index+'"')+'</details>';
  }
  html+='<h4>Record the selected decisions</h4><div class="commissioning-fields">'+
    field('Recording operator','actor',ui.actor||'',{ui:true,max:500})+
    field('Actual review time with timezone','observedAt',ui.observedAt||'',{ui:true,help:'The proposed timestamp is editable before this decision is saved.'})+'</div>'+
    button('Record selected review decisions','review-selected')+
    '<p>Each checkbox is an explicit decision. Price decisions are evaluated before the aggregate budget in the same prepared batch. Save the complete Installation edition to retain all staged decisions.</p>'+
    (view?.sharedCycles?.length?'<h4>Shared original cycles</h4>'+table(['Cycle','Explicitly associated uses'],view.sharedCycles.map(row=>[esc(row.cycleId),esc(row.entryIds.join(', '))])):'')+
    (view?.findings?.length?'<ul>'+view.findings.map(row=>'<li>'+esc(row.id)+': '+esc(row.message)+'</li>').join('')+'</ul>':'')+
    '</fieldset>';
  return html;
}

export async function commissioningAction(name,target,{document:documentValue,context,ui,api,prefix,expectedVersion,installationId=null,expectedRevision=0,actor=''}){
  const action=name.replace(/^commissioning-/,'');
  if(action==='disable'){delete documentValue.commissioning;delete ui.report;delete ui.preparedDocument;return {message:'Removed commissioning from this draft. Earlier saved editions remain complete.'};}
  if(action==='page'){ui[target.dataset.commissioningGroup+'Page']=Number(target.dataset.commissioningPage);return {};}
  const value=documentValue.commissioning;
  if(action==='remove-use'){value.uses.splice(Number(target.dataset.commissioningIndex),1);return {};}
  if(action==='remove-funding'){value.funding.splice(Number(target.dataset.commissioningIndex),1);return {};}
  if(action==='add-receipt'){
    value.uses[Number(target.dataset.commissioningIndex)].receiptLinks.push({purchaseId:'',cycleId:'',callId:'',note:''});return {};
  }
  if(action==='remove-receipt'){
    value.uses[Number(target.dataset.commissioningIndex)].receiptLinks.splice(Number(target.dataset.commissioningLink),1);return {};
  }
  const body={expectedVersion,installationId,expectedRevision,document:copy(documentValue)};
  let endpoint='/installation-commissioning-seed';
  if(action==='review'||action==='review-selected'){
    if(!currentPreparation(documentValue,ui,expectedVersion))throw new Error('Refresh this exact draft and its original source before recording the selected review decisions.');
    const selected=action==='review'?[reviewKey(target.dataset.commissioningKind,target.dataset.commissioningId)]:
      Object.entries(ui.selectedReviews||{}).filter(([,enabled])=>enabled).map(([key])=>key);
    if(!selected.length)throw new Error('Select at least one exact review checkbox.');
    const candidates=[
      ...ui.report.funding.map(row=>({kind:'FUNDING',id:row.fundingId,expectedBasisSha256:row.basisSha256})),
      ...ui.report.uses.flatMap(row=>[{kind:'PLAN',id:row.entryId,expectedBasisSha256:row.planBasisSha256},
        {kind:'OUTPUT',id:row.entryId,expectedBasisSha256:row.receivingBasisSha256}]),
      {kind:'BUDGET',id:'budget',expectedBasisSha256:ui.report.budget.basisSha256}
    ];
    body.reviews=candidates.filter(row=>selected.includes(reviewKey(row.kind,row.id))).map(row=>({
      ...row,state:ui.decisions?.[reviewKey(row.kind,row.id)]?.state||'APPROVED',
      note:ui.decisions?.[reviewKey(row.kind,row.id)]?.note||''
    }));
    if(body.reviews.length!==new Set(selected).size)throw new Error('A selected review is no longer part of this original draft. Refresh and select its current basis.');
    body.actor=ui.actor;body.observedAt=ui.observedAt;
    endpoint='/installation-commissioning-review';
  }else if(action!=='refresh')throw new Error('Unknown customer commissioning action.');
  const result=await api(prefix+endpoint,body);
  if(result.schema!==SCHEMA+'.preparation'||!result.document?.commissioning||!result.report)
    throw new Error('The original commissioning preparation did not return its complete Installation document.');
  ui.inventory=copy(result.inventory);ui.report=copy(result.report);ui.preparedDocument=copy(result.document);ui.preparedVersion=expectedVersion;
  if(!ui.actor)ui.actor=actor;
  if(!ui.observedAt)ui.observedAt=new Date().toISOString();
  return {document:result.document,message:action==='refresh'?
    'Prepared the original cycles, price selections and exact review bases. Review the complete draft, then save its next Installation edition.':
    'Staged '+result.reviewed+' explicit decisions in this draft. Save the complete Installation edition to retain them.'};
}

export function commissioningReport(view){
  if(!view)return '';
  stylesheet();
  return '<section class="commissioning-report" aria-label="Saved customer commissioning report"><h4>Customer commissioning and receiving</h4>'+
    '<div class="commissioning-summary"><p><strong>'+view.summary.mappedUses+'</strong> mapped uses</p>'+
    '<p><strong>'+view.summary.planReviewedUses+'</strong> current plan approvals</p>'+
    '<p><strong>'+view.summary.acceptedOutputs+'</strong> current useful-output acceptances</p>'+
    '<p><strong>'+view.summary.reviewedFundingGroups+'</strong> current funding reviews</p></div>'+
    '<p>Selected '+esc(view.payment.network)+' / '+esc(view.payment.asset)+' · recipient '+esc(view.payment.recipient)+'</p>'+
    table(['Active-group expected amount','Active-group budgets','Aggregate budget','Active-group settled amount','Budget review'],[[
      esc(money(view.budget.expectedAtomic)),esc(money(view.budget.selectedGroupBudgetsAtomic)),esc(money(view.budget.aggregateBudgetAtomic)),
      esc(money(view.budget.recordedSettledAtomic)),esc(reviewStatus(view.budget.review))]])+
    table(['Dated use / buyer','Original cycles','Plan decision','Output decision','Original funding'],view.uses.map(row=>[
      esc(row.entry.date)+' · '+esc(row.buyer.name)+'<br>'+esc(row.entryId),
      esc(row.cycleIds.join(', ')),esc(reviewStatus(row.planReview)),esc(reviewStatus(row.receivingReview)),
      esc(row.entry.fundingIds.join(', ')||title(row.entry.mode))+'<br>'+(row.fundingReviewed?'Price selection reviewed':'Price selection open')]))+
    table(['Funding group','Expected / cap','Native receipt identities','Recorded settlement issues'],view.funding.map(row=>[
      esc(row.fundingId),esc(money(row.expectedAtomic))+' / '+esc(money(row.budgetAtomic)),
      esc(row.receipts.map(item=>item.id).join(', ')),esc(row.issues.map(item=>item.message).join(' '))]))+
    '<p>'+esc(view.interpretation.correspondence)+'</p><p>'+esc(view.interpretation.qualification)+'</p>'+
    '<details><summary>Complete original commissioning report and source identities</summary>'+pretty(view)+'</details></section>';
}
