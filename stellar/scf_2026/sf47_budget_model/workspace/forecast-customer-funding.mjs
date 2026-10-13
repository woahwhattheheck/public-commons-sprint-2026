// MIT. Original Forecast customer funding controls and native report projection.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined?'Unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v));
const clone=v=>JSON.parse(JSON.stringify(v));
const table=(headers,rows)=>'<div class="forecast-table"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const missing=(options,ids)=>[...options,...ids.filter(id=>!options.some(o=>o[0]===id)).map(id=>[id,id+' — retained evidence; verify current assignment'])];
export function emptyFundingOpening(commercialId){return {commercialId,amountUsd:null,basis:'NOT_ENTERED',cashIds:[],sourceIds:[],note:''};}
export function fundingOpeningEditor(project,opening,{field,sourceOptions,cashOptions}){
 const value=opening||emptyFundingOpening(project.id);
 return '<fieldset data-forecast-funding="'+esc(project.id)+'"><legend>'+esc(project.title||project.id)+'</legend>'+
 '<p>Original customer scenario: <code>'+esc(project.id)+'</code>. Receipt evidence shows money received; enter only the portion still attributable and unspent at the as-of date.</p>'+
 '<div class="forecast-fields">'+
 field('Unspent customer-attributed opening funds (USD)','fundingAmount',value.amountUsd,{help:'Leave blank when unknown. Enter 0 only when reviewed as zero; the original total opening bank balance stays separate.'})+
 field('Attribution basis','fundingBasis',value.basis,{options:[['NOT_ENTERED','Not entered'],['OBSERVED_BALANCE','Observed reconciled balance'],['PLANNING_ASSUMPTION','Explicit planning assumption']]})+
 field('Original customer receipt evidence','fundingCashIds',value.cashIds,{options:missing(cashOptions,value.cashIds),multiple:true,wide:true,help:'Choose only observed receipts already assigned to this customer above. Evidence is not automatically treated as an unspent balance.'})+
 field('Balance reconciliation sources','fundingSourceIds',value.sourceIds,{options:missing(sourceOptions,value.sourceIds),multiple:true,wide:true})+
 field('Reconciliation or assumption explaining this amount','fundingNote',value.note,{area:true,wide:true,help:'Required for every entered amount, including zero. Explain what remains after completed work and other use of those receipts.'})+'</div></fieldset>';
}
export function fundingEditor(inputs,options){
 const funding=inputs.customerFunding;
 if(funding===undefined)return '<details><summary>Protect remaining customer delivery funding</summary><p>Optionally keep customer-attributed cash available for that customer’s remaining modeled delivery, including unpaid linked invoices. This planning choice records no transfer or bank restriction.</p><button type="button" data-forecast-action="start-funding">Plan customer funding protection</button></details>';
 const byId=new Map(funding.opening.map(r=>[r.commercialId,r]));
 return '<details open data-forecast-funding-policy><summary>Customer delivery funding protection</summary>'+
 '<p>Reconcile unspent attributed opening funds; future included receipts and costs then follow the original Forecast dates. No attribution is inferred from gross collected receipts. Included invoices remain obligations even when a speculative delivery scenario is excluded.</p>'+
 '<label class="forecast-check"><input type="checkbox" name="fundingEnabled"'+(funding.enabled?' checked':'')+'>Protect attributed customer funds for remaining modeled delivery</label>'+
 '<p>Turning protection off retains all entered amounts and evidence. It changes only this planning comparison; it does not release legally restricted money or alter the ledger.</p>'+
 options.field('Funding policy and scope','fundingPolicyNote',funding.note,{area:true,wide:true})+
 '<div data-forecast-funding-rows>'+inputs.commercial.map(row=>fundingOpeningEditor(row,byId.get(row.id),options)).join('')+'</div>'+
 (inputs.commercial.length?'':'<p>Add an original customer project above to enter its attribution. No customer balance has been assumed.</p>')+'</details>';
}
export function readFunding(form){
 if(!form.querySelector('[data-forecast-funding-policy]'))return undefined;
 const val=(r,n)=>r.querySelector('[name="'+n+'"]').value;
 const ids=(r,n)=>[...r.querySelector('[name="'+n+'"]').selectedOptions].map(o=>o.value);
 return {enabled:form.querySelector('[name=fundingEnabled]').checked,note:val(form,'fundingPolicyNote'),
 opening:[...form.querySelectorAll('[data-forecast-funding]')].map(row=>({commercialId:row.dataset.forecastFunding,
 amountUsd:val(row,'fundingAmount').trim()||null,basis:val(row,'fundingBasis'),cashIds:ids(row,'fundingCashIds'),
 sourceIds:ids(row,'fundingSourceIds'),note:val(row,'fundingNote')}))};
}
const perPage=60;
function pageRows(rows,page){const pages=Math.max(1,Math.ceil(rows.length/perPage));page=Math.max(0,Math.min(pages-1,Number.isSafeInteger(page)?page:0));return {page,pages,rows:rows.slice(page*perPage,(page+1)*perPage),total:rows.length};}
function navigation(part,kind){return '<div class="forecast-actions"><button type="button" data-funding-page="'+kind+'" data-page="'+(part.page-1)+'"'+(!part.page?' disabled data-forecast-fixed="true"':'')+'>Previous '+kind+'</button><span>Page '+(part.page+1)+' of '+part.pages+' · '+part.total+' complete rows</span><button type="button" data-funding-page="'+kind+'" data-page="'+(part.page+1)+'"'+(part.page+1>=part.pages?' disabled data-forecast-fixed="true"':'')+'>Next '+kind+'</button></div>';}
export function fundingReport(funding,{dayPage=0,customerPage=0,customerId=''}={}){
 if(!funding)return '';
 if(!funding.enabled)return '<section aria-label="Customer funding protection"><h5>Customer funding protection is off</h5><p>Entered opening attributions and notes remain in the saved inputs. The original pooled forecast applies.</p></section>';
 const s=funding.summary,days=pageRows(funding.days,dayPage);
 if(customerId&&!funding.projects.some(p=>p.commercialId===customerId))customerId='';
 const movements=pageRows(funding.customerDays.filter(r=>!customerId||r.commercialId===customerId),customerPage);
 const ids=values=>values.length?values.map(esc).join(', '):'None';
 return '<section data-funding-report data-day-page="'+days.page+'" data-customer-page="'+movements.page+'" data-customer-id="'+esc(customerId)+'" aria-label="Customer funding protection">'+
 '<h5>Funds available after customer delivery protection</h5><p>'+esc(funding.basis)+'</p>'+
 table(['Maximum required starting cash','Extra funding after entered total opening cash','Peak need date','End protected funds','End unreserved available cash'],[[
 money(s.maximumRequiredStartingCashUsd),money(s.extraFundingAfterOpeningUsd),esc(s.peakNeedDate||'Unknown'),money(s.endReservedCustomerFundsUsd),money(s.endUnreservedAvailableCashUsd)]])+
 (!s.reservationAndDatedCashComplete?'<p class="forecast-valuation-warning">The complete protection or dated cash calculation is unresolved. Known-portion starting requirement: '+money(s.knownPortionRequiredStartingCashUsd)+' on '+esc(s.knownPortionPeakDate)+'. This partial amount is neither the complete requirement nor a lower bound.</p>':'')+
 '<p>'+esc(funding.interpretation)+'</p><p>Policy: '+esc(funding.note||'No additional policy note.')+'</p>'+
 '<details><summary>Original attribution and remaining obligations ('+funding.projects.length+')</summary>'+
 table(['Customer','Opening attribution / basis','Evidence and reconciliation','Included unpaid invoices','Selected uninvoiced cost','Total remaining obligation','Undated remaining cost'],funding.projects.map(p=>[
 esc(p.title)+'<small>'+esc(p.commercialId)+(p.selected?' · delivery included':' · speculative delivery excluded')+'</small>',
 money(p.opening.amountUsd)+'<small>'+esc(p.opening.basis)+'</small>',
 '<strong>Receipts:</strong> '+ids(p.opening.cashIds)+'<br><strong>Sources:</strong> '+ids(p.opening.sourceIds)+'<p>'+esc(p.opening.note)+'</p>',
 money(p.includedInvoiceCostUsd)+'<small>'+ids(p.includedInvoiceIds)+'</small>',money(p.selectedRemainingUninvoicedCostUsd),
 money(p.remainingObligationUsd),money(p.undatedUninvoicedCostUsd)]))+
 '<p>Unknown opening: '+ids(s.unknownOpeningCustomerIds)+'. Unvalued remaining obligation: '+ids(s.unvaluedRemainingObligationCustomerIds)+'. Undated obligation: '+ids(s.undatedRemainingObligationCustomerIds)+'.</p></details>'+
 '<details open><summary>Pooled, protected and available cash by day</summary>'+navigation(days,'days')+
 table(['Date','Pooled change','Pooled available cash','Protected customer funds','Unreserved available cash','Unknown attributions'],days.rows.map(d=>[
 esc(d.date),money(d.pooledDeltaUsd),money(d.pooledAvailableCashUsd),money(d.reservedCustomerFundsUsd),money(d.unreservedAvailableCashUsd),
 ids(d.unknownReservationCustomerIds)]))+'</details>'+
 '<details><summary>Complete customer-by-day movement</summary><label>Customer <select data-funding-customer><option value="">All original customers</option>'+
 funding.projects.map(p=>'<option value="'+esc(p.commercialId)+'"'+(p.commercialId===customerId?' selected':'')+'>'+esc(p.title||p.commercialId)+'</option>').join('')+
 '</select></label>'+navigation(movements,'customers')+
 table(['Date','Customer','Included inflow','Included cost outflow','Attributed balance','Remaining obligation','Protected','Original events'],movements.rows.map(r=>[
 esc(r.date),esc(r.title),money(r.forecastInflowUsd),money(r.includedCostOutflowUsd),
 money(r.attributedBalanceUsd),money(r.remainingObligationUsd),money(r.reservedUsd),
 r.eventIds.map(e=>esc(e.kind+':'+e.id)).join('<br>')+(r.unknownFlowActive?'<p>Unknown-valued customer flow is active; displayed movements include only known events.</p>':'')]))+'</details>'+
 '<p>The original complete forecast ZIP retains every date, customer, exact assumption and source. Paging changes only this view.</p></section>';
}
export function handleFundingReport(event,funding){
 const control=event.target.closest('[data-funding-page],[data-funding-customer]');
 if(!control)return false;
 if(control.matches('[data-funding-customer]')?event.type!=='change':event.type!=='click')return false;
 const section=control.closest('[data-funding-report]');if(!section||!funding?.enabled)return false;
 event.preventDefault();
 const state={dayPage:Number(section.dataset.dayPage),customerPage:Number(section.dataset.customerPage),customerId:section.dataset.customerId};
 if(control.matches('[data-funding-customer]')){state.customerId=control.value;state.customerPage=0;}
 else if(control.dataset.fundingPage==='days')state.dayPage=Number(control.dataset.page);
 else state.customerPage=Number(control.dataset.page);
 const opened=[...section.querySelectorAll('details')].map(d=>d.open);
 const parent=section.parentNode,holder=document.createElement('div');holder.innerHTML=fundingReport(funding,state);
 const next=holder.firstElementChild;[...next.querySelectorAll('details')].forEach((d,i)=>{d.open=opened[i];});
 section.replaceWith(next);
 const destination=next.querySelector(control.matches('[data-funding-customer]')?'[data-funding-customer]':'[data-funding-page="'+control.dataset.fundingPage+'"]:not([disabled])');
 destination?.focus();return true;
}
