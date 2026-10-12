const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd = value => value === null || value === undefined ? 'Not entered' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
const today = () => new Date().toISOString().slice(0,10);
const table = (headers, rows) => '<div class="forecast-table"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const button = (label, action, attributes='') => '<button type="button" data-forecast-action="'+action+'" '+attributes+'>'+esc(label)+'</button>';
const empty = value => '<p class="forecast-muted">'+esc(value)+'</p>';
function field(label,name,value='',config={}) {
  const attrs=' name="'+esc(name)+'"'+(config.required?' required':'');
  let control;
  if(config.options) control='<select'+attrs+(config.multiple?' multiple size="3"':'')+'>'+config.options.map(([id,title])=>'<option value="'+esc(id)+'"'+((config.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';
  else if(config.area) control='<textarea'+attrs+' rows="'+(config.rows||2)+'">'+esc(value)+'</textarea>';
  else control='<input'+attrs+' type="'+(config.type||'text')+'" value="'+esc(value)+'"'+(config.placeholder?' placeholder="'+esc(config.placeholder)+'"':'')+'>';
  return '<label'+(config.wide?' class="forecast-wide"':'')+'>'+esc(label)+control+(config.help?'<small>'+esc(config.help)+'</small>':'')+'</label>';
}
const options=(...items)=>items.map(value=>[value,value.replaceAll('_',' ').toLowerCase()]);
const selectedValues = (root,name) => [...root.querySelector('[name="'+name+'"]').selectedOptions].map(row=>row.value);
const value = (root,name) => root.querySelector('[name="'+name+'"]').value;
const optional = (root,name) => value(root,name).trim() || null;
function download(raw,filename,type='application/json') {
  const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}

export function mountForecast({container,current,api:transport,mutationId,recordingActor,onSaved,initialForecastId=null,initialInputs=null,onSelection=()=>{}}) {
  const root=document.createElement('section');root.className='operating-forecast';container.replaceChildren(root);
  let active=true,busy=false,selected=null,preview=null,editing=true,inputState=null,request=null;
  const available=()=>active&&root.isConnected;
  function requireActive(){if(!available())throw new Error('This forecast view is closed. Reopen its original case to continue.');}
  async function api(...args){requireActive();const result=await transport(...args);requireActive();return result;}
  const path='/api/operations/'+current.program.id;
  const sourceOptions=current.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]);
  const cashOptions=(direction,customer=false)=>current.records.cash.filter(row=>row.state==='OBSERVED'&&row.direction===direction&&row.usdValue!==null&&!row.network.toLowerCase().includes('testnet')&&(customer?row.category==='CUSTOMER':!row.allocations.length)).map(row=>[row.id,row.date+' · '+usd(row.usdValue)+' · '+row.externalRef]);
  const invoiceOptions=current.records.invoices.filter(row=>row.lines.every(line=>line.costId===null)).map(row=>[row.id,row.number+' · '+usd(row.totalUsd)]);
  const costMap=new Map(current.report.packages.map(row=>[row.id,row]));
  const $=selector=>root.querySelector(selector);
  function defaults(){return {name:current.program.name+' — operating forecast',asOfDate:today(),calendarStart:current.program.calendarStart||current.plan.planning.calendarStart||'',
    openingCash:{amountUsd:null,basis:'NOT_ENTERED',sourceIds:[],note:''},packageOverrides:[],invoiceOverrides:[],grantReceipts:[],commercial:[],capacity:{weeklyHours:null,note:''},note:''};}
  function status(message,error=false){if(!available())return;const node=$('[data-forecast-status]');node.textContent=message;node.setAttribute('role',error?'alert':'status');}
  function setBusy(state){busy=state;if(!available())return;root.setAttribute('aria-busy',String(state));root.querySelectorAll('input,select,textarea,button').forEach(node=>node.disabled=state||node.dataset.forecastFixed==='true');}
  async function run(task){if(busy||!available())return;setBusy(true);try{await task();}catch(error){status(error.message,true);}finally{if(available())setBusy(false);}}
  function invalidate(){preview=null;request=null;const save=$('[data-forecast-action=save]');if(save){save.disabled=true;save.dataset.forecastFixed='true';}const note=$('[data-forecast-preview-state]');if(note)note.textContent='Inputs changed. Preview this source and these inputs before saving.';}
  function packageEditor(row){
    const prior=costMap.get(row.costId), direct=cashOptions('OUT');
    return '<fieldset data-forecast-package="'+esc(row.costId)+'"><legend>'+esc(row.costId)+'</legend><p class="forecast-muted">Pinned '+usd(prior.plannedUsd)+' · invoices '+usd(prior.invoicedUsd)+' · paid allocations '+usd(prior.paidUsd)+' · accepted '+esc(prior.acceptedHours)+' / '+esc(prior.plannedHours)+' hours.</p><div class="forecast-fields">'
      +field('Remaining uninvoiced cash (USD)','remainingCostUsd',row.remainingCostUsd,{placeholder:'Calculate from original allocation',help:'Blank keeps the allocation less original invoices and assigned direct payments. Re-estimate completed but unbilled obligations as needed.'})
      +field('Remaining work hours','remainingHours',row.remainingHours,{placeholder:'Pinned hours less accepted work'})
      +field('Work starts','startDate',row.startDate,{type:'date'})+field('Work finishes','endDate',row.endDate,{type:'date'})
      +field('Cash schedule','paymentMode',row.paymentMode||'original',{options:[['original','Original payment schedule'],['accrual','Evenly over remaining dates'],['completion','At remaining work completion']]})
      +field('Actual direct payments assigned to this package','directCashIds',row.directCashIds||[],{options:direct,multiple:true})
      +field('Reason / source for changed estimates or dates','note',row.note||'',{area:true,wide:true})+'</div></fieldset>';
  }
  function invoiceEditor(row){
    const original=current.report.invoices.find(x=>x.id===row.invoiceId);
    return '<tr data-forecast-invoice="'+esc(row.invoiceId)+'"><td>'+esc(original.number)+'<small>'+esc(original.state)+' · source due '+esc(original.dueDate||'undated')+'</small></td><td>'+usd(original.totalUsd)+'</td><td>'+usd(original.paidUsd)+'</td><td>'+usd(original.openUsd)+'</td><td><input aria-label="Expected payment for '+esc(original.number)+'" name="dueDate" type="date" value="'+esc(row.dueDate||'')+'"></td><td><label class="forecast-check"><input name="include" type="checkbox"'+(row.include===false?'':' checked')+'>Include</label></td><td><input aria-label="Timing or exclusion reason for '+esc(original.number)+'" name="note" value="'+esc(row.note||'')+'"></td></tr>';
  }
  function receiptEditor(row,index){
    return '<tr data-forecast-receipt><td><input name="receiptId" aria-label="Receipt identity" value="'+esc(row.id||'milestone-'+(index+1))+'" required></td><td><input name="receiptLabel" aria-label="Receipt label" value="'+esc(row.label||'')+'" required></td><td><input name="receiptAmount" aria-label="Quoted milestone USD" value="'+esc(row.amountUsd||'')+'" required></td><td><input name="receiptDate" aria-label="Forecast collection date" type="date" value="'+esc(row.date||'')+'"></td><td data-forecast-timing-only><input name="receiptCondition" aria-label="Original relative collection term" value="'+esc(row.condition||'')+'" placeholder="Before work, or days after accepted handover"></td><td>'+button('Remove','remove-receipt')+'</td></tr>';
  }
  function commercialEditor(row){
    const timed=row.timing?.mode==='EVENT_DEPENDENT', conditions=new Map((row.timing?.receiptConditions||[]).map(item=>[item.receiptId,item.condition]));
    return '<fieldset data-forecast-commercial="'+esc(row.id)+'"><legend>'+esc(row.title||'Customer delivery scenario')+'</legend><div class="forecast-actions">'+button('Remove project','remove-commercial')+'</div><div class="forecast-fields">'
      +field('Project name','title',row.title,{required:true})+field('Original case / offer identity','caseRef',row.caseRef,{required:true})
      +field('Original commercial stage','stage',row.stage||'QUOTED',{options:[['QUOTED','Quoted offer'],['AGREED','Agreed scope'],['IN_PROGRESS','Implementation in progress']]})
      +'<label class="forecast-check"><input name="selected" type="checkbox"'+(row.selected===false?'':' checked')+'>Include this customer delivery scenario</label>'
      +field('Original total quoted price (USD)','priceUsd',row.priceUsd,{required:true})
      +field('Current total customer-specific delivery cost (USD)','totalDeliveryCostUsd',row.totalDeliveryCostUsd,{required:true,help:'Includes linked invoices and assigned direct payments. Existing reusable product development stays in its original scope.'})
      +field('Remaining customer-specific hours','remainingHours',row.remainingHours,{required:true})
      +field('Work timing','timingMode',timed?'EVENT_DEPENDENT':'DATED',{options:[['DATED','Dated work window'],['EVENT_DEPENDENT','After an original deposit or other event']]})
      +field('Delivery starts','startDate',row.startDate,{type:'date',required:!timed})+field('Delivery finishes','endDate',row.endDate,{type:'date',required:!timed})
      +'<div data-forecast-timing-only class="forecast-wide"><div class="forecast-fields">'
      +field('Original condition before work can start','timingStartCondition',row.timing?.startCondition||'',{area:true,wide:true,help:'Retain the original deposit, agreed inputs and named review prerequisites. Leave both work dates empty until its reviewed window is known.'})
      +field('Quoted delivery window (business days)','timingDeliveryBusinessDays',row.timing?.deliveryBusinessDays??1,{type:'number',help:'The original Portfolio derives the delivery deadline from the reviewed release date and selected working calendar.'})+'</div></div>'
      +field('Cost timing','paymentMode',row.paymentMode||'accrual',{options:[['accrual','Evenly over delivery dates'],['completion','At delivery completion']]})
      +field('Original offer URL','sourceUrl',row.sourceUrl,{type:'url',wide:true})
      +field('Retained source attachments','sourceIds',row.sourceIds||[],{options:sourceOptions,multiple:true,wide:true})
      +field('Actual collected customer receipts','cashIds',row.cashIds||[],{options:cashOptions('IN',true),multiple:true,help:'Only the selected original observed receipts reduce this price. They remain unchanged.'})
      +field('Original customer-specific invoices','invoiceIds',row.invoiceIds||[],{options:invoiceOptions,multiple:true,help:'Each unplanned invoice may belong to one customer scenario.'})
      +field('Actual direct payments','directCashIds',row.directCashIds||[],{options:cashOptions('OUT'),multiple:true})
      +field('Scope, prerequisites and acceptance','scope',row.scope||'',{area:true,wide:true})
      +field('Source of cost, remaining hours and forecast dates','note',row.note||'',{area:true,required:true,wide:true})
      +'</div><h5>Original payment milestones and forecast collection dates</h5><p class="forecast-muted">Amounts must sum to the original price. Leave a collection date empty until a date can be forecast. Observed receipts reduce the listed milestones in their original order.</p>'
      +'<div class="forecast-table"><table><thead><tr><th>Identity</th><th>Milestone</th><th>Quoted USD</th><th>Forecast collection</th><th data-forecast-timing-only>Original relative collection term</th><th>Action</th></tr></thead><tbody data-forecast-receipts>'+row.receipts.map((receipt,index)=>receiptEditor({...receipt,condition:conditions.get(receipt.id)||''},index)).join('')+'</tbody></table></div>'+button('Add receipt milestone','add-receipt')+'</fieldset>';
  }
  function syncCommercialTiming(row){
    const timed=value(row,'timingMode')==='EVENT_DEPENDENT';
    for(const node of row.querySelectorAll('[data-forecast-timing-only]'))node.hidden=!timed;
    for(const name of ['startDate','endDate'])row.querySelector('[name="'+name+'"]').required=!timed;
    for(const node of row.querySelectorAll('[name=timingStartCondition],[name=timingDeliveryBusinessDays],[name=receiptCondition]')){
      node.required=timed;node.disabled=busy||!timed;node.dataset.forecastFixed=String(!timed);
    }
  }
  function editor(inputs){
    const packages=new Map(inputs.packageOverrides.map(row=>[row.costId,row]));
    const invoices=new Map(inputs.invoiceOverrides.map(row=>[row.invoiceId,row]));
    const grants=new Map(inputs.grantReceipts.map(row=>[row.tranche,row]));
    return '<form data-forecast-form><div class="forecast-fields">'
      +field('Forecast name','name',inputs.name,{required:true,wide:true})
      +field('As-of date','asOfDate',inputs.asOfDate,{type:'date',required:true,help:'Actual cash and completed work through this date. Forward cash begins the next day.'})
      +field('Explicit plan day-zero date','calendarStart',inputs.calendarStart,{type:'date',required:true,help:'A schedule assumption or actual anchor; selecting it does not record an award.'})
      +field('Available cash at end of as-of date (USD)','openingAmount',inputs.openingCash.amountUsd,{help:'Optional. The original plan’s capital input and net recorded flows are not substituted for a balance.'})
      +field('Opening balance basis','openingBasis',inputs.openingCash.basis,{options:[['NOT_ENTERED','No balance entered'],['OBSERVED_BALANCE','Observed balance'],['PLANNING_ASSUMPTION','Planning assumption']]})
      +field('Opening balance source / assumption','openingNote',inputs.openingCash.note,{area:true,wide:true})
      +field('Opening balance source attachments','openingSources',inputs.openingCash.sourceIds,{options:sourceOptions,multiple:true,wide:true})
      +field('Available weekly team hours','weeklyHours',inputs.capacity.weeklyHours,{help:'Blank uses the pinned contributor capacities when available. This is a shared capacity comparison across selected work.'})
      +field('Capacity source / assumption','capacityNote',inputs.capacity.note,{area:true})
      +field('Forecast decisions and assumptions','forecastNote',inputs.note,{area:true,wide:true})
      +'</div><details open><summary>Remaining grant packages</summary><p>Existing invoices remain separate obligations. Package cash defaults subtract their full recorded amounts; the invoice section then includes only unpaid balances. Accepted work reduces remaining hours.</p>'
      +current.plan.scenario.future_costs.map(row=>packageEditor(packages.get(row.id)||{costId:row.id})).join('')+'</details>'
      +'<details><summary>Unpaid invoices and expected payment dates</summary><p>Overdue or undated balances move to the next day until a new date is entered. Every exclusion needs a reason.</p>'
      +(current.report.invoices.length?'<div class="forecast-table"><table><thead><tr><th>Original invoice</th><th>Total</th><th>Paid</th><th>Open</th><th>Expected payment</th><th>Include</th><th>Reason</th></tr></thead><tbody>'+current.report.invoices.map(row=>invoiceEditor(invoices.get(row.id)||{invoiceId:row.id})).join('')+'</tbody></table></div>':empty('No invoice records in this case.'))+'</details>'
      +'<details><summary>Conditional grant receipt dates</summary><p>A past-due unreceived payout stays outside the cash curve until a new date is entered. Original observed grant receipts reduce their own tranches.</p><div class="forecast-table"><table><thead><tr><th>Tranche</th><th>Conditional total</th><th>Observed</th><th>New forecast receipt</th><th>Include</th><th>Reason</th></tr></thead><tbody>'
      +current.report.tranches.map(row=>{const input=grants.get(row.tranche)||{};return '<tr data-forecast-grant="'+row.tranche+'"><td>'+row.tranche+' · original day '+row.hypotheticalPaidDay+'</td><td>'+usd(row.conditionalPlannedUsd)+'</td><td>'+usd(row.observedGrantUsd)+'</td><td><input name="date" aria-label="Tranche '+row.tranche+' forecast date" type="date" value="'+esc(input.date||'')+'"></td><td><label class="forecast-check"><input name="include" type="checkbox"'+(input.include===false?'':' checked')+'>Include</label></td><td><input name="note" aria-label="Tranche '+row.tranche+' timing source" value="'+esc(input.note||'')+'"></td></tr>';}).join('')+'</tbody></table></div></details>'
      +'<details open><summary>Customer delivery scenarios</summary><p>Each project carries the original quote, collection schedule and delivery cost. Add only the customer-specific remaining scope.</p><div data-forecast-commercials>'+inputs.commercial.map(commercialEditor).join('')+'</div>'+button('Add customer project','add-commercial')+'</details>'
      +'<div class="forecast-actions"><button type="submit">Preview current forecast</button>'+button('Load input JSON','load-inputs')+button('Download input JSON','download-inputs')+'</div><input hidden data-forecast-input-file type="file" accept=".json,application/json"></form>';
  }
  function readEditor(){
    const form=$('[data-forecast-form]');if(!form)throw new Error('Choose Reforecast current case to edit assumptions.');
    const explicitGrants=new Set(inputState.grantReceipts.map(row=>Number(row.tranche)));
    const inputs={name:value(form,'name'),asOfDate:value(form,'asOfDate'),calendarStart:value(form,'calendarStart'),
      openingCash:{amountUsd:optional(form,'openingAmount'),basis:value(form,'openingBasis'),sourceIds:selectedValues(form,'openingSources'),note:value(form,'openingNote')},
      capacity:{weeklyHours:optional(form,'weeklyHours'),note:value(form,'capacityNote')},note:value(form,'forecastNote'),
      packageOverrides:[...form.querySelectorAll('[data-forecast-package]')].map(row=>({costId:row.dataset.forecastPackage,
        remainingCostUsd:optional(row,'remainingCostUsd'),remainingHours:optional(row,'remainingHours'),
        startDate:optional(row,'startDate'),endDate:optional(row,'endDate'),paymentMode:value(row,'paymentMode'),directCashIds:selectedValues(row,'directCashIds'),note:value(row,'note')})),
      invoiceOverrides:[...form.querySelectorAll('[data-forecast-invoice]')].map(row=>({invoiceId:row.dataset.forecastInvoice,dueDate:optional(row,'dueDate'),include:row.querySelector('[name=include]').checked,note:value(row,'note')})),
      grantReceipts:[...form.querySelectorAll('[data-forecast-grant]')].map(row=>({tranche:Number(row.dataset.forecastGrant),date:optional(row,'date'),include:row.querySelector('[name=include]').checked,note:value(row,'note')})).filter(row=>explicitGrants.has(row.tranche)||row.date!==null||row.include===false||row.note!==''),
      commercial:[...form.querySelectorAll('[data-forecast-commercial]')].map(row=>({id:row.dataset.forecastCommercial,title:value(row,'title'),
        caseRef:value(row,'caseRef'),stage:value(row,'stage'),selected:row.querySelector('[name=selected]').checked,
        priceUsd:value(row,'priceUsd'),totalDeliveryCostUsd:value(row,'totalDeliveryCostUsd'),remainingHours:value(row,'remainingHours'),
        startDate:optional(row,'startDate'),endDate:optional(row,'endDate'),paymentMode:value(row,'paymentMode'),
        ...(value(row,'timingMode')==='EVENT_DEPENDENT'?{timing:{mode:'EVENT_DEPENDENT',
          startCondition:value(row,'timingStartCondition'),deliveryBusinessDays:Number(value(row,'timingDeliveryBusinessDays')),
          receiptConditions:[...row.querySelectorAll('[data-forecast-receipt]')].map(receipt=>({receiptId:value(receipt,'receiptId'),condition:value(receipt,'receiptCondition')}))}}:{}),
        sourceUrl:value(row,'sourceUrl'),sourceIds:selectedValues(row,'sourceIds'),cashIds:selectedValues(row,'cashIds'),
        invoiceIds:selectedValues(row,'invoiceIds'),directCashIds:selectedValues(row,'directCashIds'),scope:value(row,'scope'),note:value(row,'note'),
        receipts:[...row.querySelectorAll('[data-forecast-receipt]')].map(receipt=>({id:value(receipt,'receiptId'),label:value(receipt,'receiptLabel'),amountUsd:value(receipt,'receiptAmount'),date:optional(receipt,'receiptDate')}))}))};
    return inputs;
  }
  function chart(report){
    const series=[['spendingOnly','Existing obligations and grant work',''],['conditionalGrant','With conditional grants','8 4'],['commercial','With selected customer work','2 4']];
    const key=report.openingCash.amountUsd===null?'DeltaUsd':'BalanceUsd';
    const amounts=report.days.flatMap(day=>series.map(([id])=>Number(day[id+key])));
    const low=Math.min(0,...amounts),high=Math.max(1,...amounts),span=high-low||1,w=900,h=260,x0=90,y0=20,plotW=790,plotH=190;
    const x=i=>x0+i*plotW/Math.max(report.days.length-1,1),y=n=>y0+(high-n)/span*plotH;
    return '<figure class="forecast-chart"><figcaption>'+esc(key==='DeltaUsd'?'Cumulative forward cash change (opening cash not entered)':'Forecast available cash including entered opening balance')+'</figcaption>'
      +'<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Dated forecast cash scenarios"><line x1="'+x0+'" y1="'+y(0)+'" x2="'+(x0+plotW)+'" y2="'+y(0)+'" stroke="#888"/>'
      +[high,(high+low)/2,low].map(amount=>'<text x="80" y="'+(y(amount)+4)+'" text-anchor="end">'+esc(usd(amount))+'</text>').join('')
      +series.map(([id,label,dash],index)=>'<polyline fill="none" stroke="'+['#151515','#555','#888'][index]+'" stroke-width="2.5" stroke-dasharray="'+dash+'" points="'+report.days.map((day,i)=>x(i).toFixed(2)+','+y(Number(day[id+key])).toFixed(2)).join(' ')+'"><title>'+esc(label)+'</title></polyline>').join('')
      +'<text x="'+x0+'" y="240">'+esc(report.days[0]?.date||'')+'</text><text x="'+(x0+plotW)+'" y="240" text-anchor="end">'+esc(report.lastForecastDate)+'</text></svg>'
      +'<div class="forecast-legend">'+series.map(([id,label],index)=>'<span><i class="forecast-line line-'+index+'"></i>'+esc(label)+'</span>').join('')+'</div></figure>';
  }
  function eventTimingHtml(report){
    const timing=report.eventTiming;if(!timing)return '';
    return '<section class="forecast-note"><h5>Event-dependent work and collections</h5><p>'+esc(timing.undatedHours)+' selected work hours and '+usd(timing.undatedDeliveryCostUsd)+' of delivery costs await work dates. '+usd(timing.undatedCustomerReceiptsUsd)+' of quoted collections await collection dates. These amounts remain in the complete scope; the cash and capacity curves cover entered dates.</p>'
      +table(['Project','Original start condition','Delivery working days','Work window','Original collection terms'],timing.projects.map(row=>[
        esc(row.title)+(row.selected?'':'<small>Excluded from this scenario</small>'),esc(row.startCondition),esc(row.deliveryBusinessDays),
        row.startDate?esc(row.startDate)+' — '+esc(row.endDate):'Awaiting reviewed dates',
        row.receipts.map(receipt=>esc(receipt.label)+' · '+usd(receipt.amountUsd)+' · '+esc(receipt.condition)+'<small>'+(receipt.date?esc(receipt.date):'Collection date not entered')+'</small>').join('<br>')
      ]))+'<p>'+esc(timing.basis)+'</p></section>';
  }
  function reportHtml(result,isPreview=false){
    const r=result.report;
    const scenarioRows=[['spendingOnly','Existing obligations and grant work'],['conditionalGrant','With conditional grant receipts'],['commercial','With selected customer delivery']].map(([id,label])=>{const row=r.scenarios[id];return [esc(label),usd(row.additionalCashNeededUsd),usd(row.gapAfterOpeningCashUsd),esc(row.peakNeedDate),usd(row.endBalanceUsd)];});
    const warnings=r.issues.map(row=>'<li><strong>'+esc(row.code.replaceAll('_',' ').toLowerCase())+'</strong> · '+esc(row.id)+': '+esc(row.message)+(row.amountUsd?' '+usd(row.amountUsd):'')+'</li>').join('');
    return '<section aria-label="Operating forecast result"><div class="forecast-heading"><div><h4>'+esc(result.inputs.name)+'</h4><p>As of '+esc(r.asOfDate)+' · source case version '+result.source.version+' · pinned plan revision '+result.source.planRevision+'</p></div><div class="forecast-actions">'
      +(isPreview?button('Save this forecast','save',current.program.state==='CLOSED'?'disabled data-forecast-fixed="true"':''):button('Download complete forecast','export-forecast')+button('Download original forecast JSON','export-json'))
      +'</div></div>'+(isPreview?'<p data-forecast-preview-state>Preview ready. Saving retains this exact calculation and its original source.</p>':'<p class="forecast-muted">Saved by '+esc(result.actor)+' on '+esc(result.createdAt)+'. '+(result.current?.sourceChanged?'The current operating records differ. This view retains the original saved calculation.':'The retained operating facts still match the current case.')+'</p>')
      +'<div class="forecast-stats">'+[['Unpaid invoice obligations',usd(r.totals.openInvoiceUsd)],['Remaining grant package cash',usd(r.totals.remainingPackageCostUsd)],['Selected customer delivery cash',usd(r.totals.selectedCommercialUninvoicedCostUsd)],['Remaining grant / customer hours',r.totals.remainingGrantPackageHours+' / '+r.totals.selectedCommercialHours]].map(([label,total])=>'<div><span>'+esc(label)+'</span><strong>'+esc(total)+'</strong></div>').join('')+'</div>'
      +eventTimingHtml(r)+table(['Scenario','Cash needed before opening balance','Gap after opening balance','Peak need date','Ending available cash'],scenarioRows)+chart(r)
      +'<h5>Remaining delivery capacity</h5><p>'+esc(r.capacity.peakWeeklyEquivalentHours)+' peak weekly-equivalent hours; '+(r.capacity.weeklyHours===null?'available capacity has not been entered.':esc(r.capacity.weeklyHours)+' available weekly hours; '+r.capacity.overloadedDays+' modeled overloaded calendar days.')+'</p>'
      +'<details open><summary>Remaining work packages</summary>'+table(['Package','Invoice / paid USD','Remaining uninvoiced cash','Remaining hours','Dates','Estimate source'],r.packages.map(row=>[esc(row.id),usd(row.invoicedUsd)+' / '+usd(row.paidUsd),usd(row.remainingCostUsd),esc(row.remainingHours),esc(row.startDate)+' — '+esc(row.endDate),esc(row.note||'Pinned allocation less recorded invoices and assigned direct payments')]))+'</details>'
      +'<details open><summary>Customer delivery decisions</summary>'+(r.commercial.length?table(['Project / original stage','Original price / observed receipts','Remaining delivery cash','Uncollected price','Remaining hours / dates','Scenario'],r.commercial.map(row=>[esc(row.title)+'<small>'+esc(row.stage)+' · '+esc(row.caseRef)+'</small>',usd(row.priceUsd)+' / '+usd(row.observedReceiptsUsd),usd(row.totalRemainingCashCostUsd),usd(row.uncollectedPriceUsd),esc(row.remainingHours)+'<small>'+(row.startDate?esc(row.startDate)+' — '+esc(row.endDate):'Awaiting original start condition')+'</small>',row.selected?'Included':'Excluded'])):empty('No customer scenario selected.'))+'</details>'
      +'<details><summary>Conditional grant amounts</summary>'+table(['Tranche','Original conditional amount','Observed receipt','Remaining amount','Forecast date'],r.grants.map(row=>[esc(row.tranche),usd(row.conditionalPlannedUsd),usd(row.observedGrantUsd),usd(row.remainingUsd),esc(row.included?(row.forecastDate||'Needs new date'):'Excluded')]))+'</details>'
      +'<details'+(r.issues.length?' open':'')+'><summary>Source and estimate decisions ('+r.issues.length+')</summary>'+(warnings?'<ul>'+warnings+'</ul>':empty('No outstanding date or allocation decisions.'))+'</details>'
      +'<details><summary>Complete dated cash and work</summary>'+table(['Date','Invoice out','Grant work out','Customer work out','Conditional grants','Customer collections','Combined cash change','Hours'],r.days.map(row=>[esc(row.date),usd(row.invoiceOutflowUsd),usd(row.packageOutflowUsd),usd(row.commercialOutflowUsd),usd(row.conditionalGrantInflowUsd),usd(row.forecastCustomerInflowUsd),usd(row.commercialDeltaUsd),esc(row.remainingWorkHours)]))+'</details>'
      +'<details><summary>Original source and assumptions</summary><p>'+esc(r.basis)+'</p><p>Opening cash: '+esc(r.openingCash.basis)+' · '+esc(r.openingCash.note)+'</p><p>'+esc(result.inputs.note)+'</p><dl><dt>Original case</dt><dd>'+esc(result.source.programId)+'</dd><dt>Plan content</dt><dd>'+esc(result.source.planContentSha256)+'</dd><dt>Business snapshot</dt><dd>'+esc(result.source.businessSha256)+'</dd><dt>Preview</dt><dd>'+esc(result.previewSha256)+'</dd>'+(result.sha256?'<dt>Complete saved forecast</dt><dd>'+esc(result.sha256)+'</dd>':'')+'</dl></details></section>';
  }
  function render(){
    if(!available())return;
    root.innerHTML='<div class="forecast-heading"><div><h3>Operating forecast</h3><p>Replan remaining cash and delivery work from this retained case.</p></div><div class="forecast-actions">'+button('New forecast','new')+(selected?button('Reforecast current case','reforecast'):'')+'</div></div>'
      +'<label class="forecast-saved-label">Saved forecasts<select data-forecast-selection><option value="">Current draft</option>'+current.forecasts.map(row=>'<option value="'+esc(row.id)+'"'+(selected?.id===row.id?' selected':'')+'>'+esc(row.name)+' · '+esc(row.asOfDate)+' · original v'+row.source.version+'</option>').join('')+'</select></label>'
      +'<p data-forecast-status role="status" aria-live="polite"></p>'
      +(current.program.state==='CLOSED'?'<p class="forecast-note">This case is closed. You can inspect and preview forecasts; reopen the case in its original controls before saving a new forecast.</p>':'')
      +(editing?editor(inputState||defaults()):'')+'<div data-forecast-report>'+(selected&&!editing?reportHtml(selected):'')+'</div>';
    root.querySelectorAll('[data-forecast-commercial]').forEach(syncCommercialTiming);
  }
  async function loadSaved(id){selected=await api(path+'/forecasts/'+id);editing=false;preview=null;request=null;onSelection(id);render();status('Reopened the original saved forecast.');}
  async function doPreview(){
    inputState=readEditor();preview=await api(path+'/forecast-preview',{expectedVersion:current.program.version,inputs:inputState});
    inputState=preview.inputs;selected=null;request=null;onSelection(null);
    $('[data-forecast-report]').innerHTML=reportHtml(preview,true);status('Current source and dated assumptions are ready to save.');
  }
  root.addEventListener('input',event=>{if(event.target.closest('[data-forecast-form]'))invalidate();});
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-forecast-selection]')){const id=event.target.value;run(async()=>{if(id)await loadSaved(id);else{selected=null;editing=true;onSelection(null);render();}});return;}
    if(event.target.closest('[data-forecast-form]'))invalidate();
    if(event.target.matches('[name=timingMode]'))syncCommercialTiming(event.target.closest('[data-forecast-commercial]'));
    if(event.target.matches('[data-forecast-input-file]')){
      const file=event.target.files[0];if(!file)return;
      run(async()=>{if(file.size>8*1024*1024)throw new Error('Forecast inputs must fit the original 8 MiB input bound.');const loaded=JSON.parse(await file.text());requireActive();if(!loaded||typeof loaded!=='object'||Array.isArray(loaded))throw new Error('Load a forecast input object.');
        // The original service normalizes every imported input before any save.
        const candidate=await api(path+'/forecast-preview',{expectedVersion:current.program.version,inputs:loaded});inputState=candidate.inputs;selected=null;editing=true;preview=candidate;request=null;onSelection(null);render();$('[data-forecast-report]').innerHTML=reportHtml(candidate,true);status('Loaded and previewed the complete input scenario.');});
    }
  });
  root.addEventListener('submit',event=>{if(!event.target.matches('[data-forecast-form]'))return;event.preventDefault();const inputs=readEditor();run(async()=>{inputState=inputs;await doPreview();});});
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-forecast-action]');if(!target)return;
    const action=target.dataset.forecastAction;
    if(action==='add-commercial'&&!busy){invalidate();const row={id:'project-'+crypto.randomUUID(),title:'',caseRef:'',stage:'QUOTED',selected:true,priceUsd:'',totalDeliveryCostUsd:'',remainingHours:'',startDate:'',endDate:'',paymentMode:'accrual',sourceUrl:'',sourceIds:[],cashIds:[],invoiceIds:[],directCashIds:[],scope:'',note:'',receipts:[{id:'kickoff',label:'Kickoff',amountUsd:'',date:null},{id:'acceptance',label:'Acceptance',amountUsd:'',date:null}]};$('[data-forecast-commercials]').insertAdjacentHTML('beforeend',commercialEditor(row));syncCommercialTiming($('[data-forecast-commercials]').lastElementChild);return;}
    if(action==='remove-commercial'&&!busy){target.closest('[data-forecast-commercial]').remove();invalidate();return;}
    if(action==='add-receipt'&&!busy){const body=target.closest('[data-forecast-commercial]').querySelector('[data-forecast-receipts]');body.insertAdjacentHTML('beforeend',receiptEditor({id:'receipt-'+crypto.randomUUID(),label:'',amountUsd:''},body.children.length));syncCommercialTiming(body.closest('[data-forecast-commercial]'));invalidate();return;}
    if(action==='remove-receipt'&&!busy){target.closest('[data-forecast-receipt]').remove();invalidate();return;}
    if(action==='load-inputs'&&!busy){const input=$('[data-forecast-input-file]');input.value='';input.click();return;}
    if(action==='download-inputs'&&!busy){download(JSON.stringify(readEditor(),null,2)+'\n','operating-forecast-inputs.json');return;}
    run(async()=>{
      if(action==='new'){inputState=defaults();selected=null;preview=null;request=null;editing=true;onSelection(null);render();return;}
      if(action==='reforecast'){inputState=structuredClone(selected.inputs);inputState.name+=' — updated';selected=null;preview=null;request=null;editing=true;onSelection(null);render();return;}
      if(action==='save'){
        if(!preview)throw new Error('Preview the current inputs before saving.');
        if(current.program.state==='CLOSED')throw new Error('Reopen the original case before saving this forecast.');
        const payload={expectedVersion:current.program.version,actor:recordingActor(),note:inputState.note,action:'forecast.save',data:{inputs:inputState,expectedPreviewSha256:preview.previewSha256}};
        if(!request){payload.requestId=await mutationId('operations:'+current.program.id,payload);requireActive();request=payload;}
        const result=await api(path+'/command',request);onSelection(result.recordId);await onSaved(result);return;
      }
      if(action==='export-forecast'){const response=await api(path+'/forecasts/'+selected.id+'/export.zip',undefined,{download:true});const blob=await response.blob();requireActive();download(blob,selected.id+'.zip','application/zip');status('Downloaded the complete saved forecast and dated cash/work exports.');return;}
      if(action==='export-json'){const body=structuredClone(selected);delete body.current;download(JSON.stringify(body,null,2)+'\n',selected.id+'.json');return;}
    });
  });
  inputState=initialInputs?structuredClone(initialInputs):defaults();render();
  const ready=initialForecastId&&!initialInputs?loadSaved(initialForecastId):Promise.resolve();
  return {ready,draftInputs(){return editing&&available()?structuredClone(readEditor()):null;},dispose(){active=false;},root};
}
