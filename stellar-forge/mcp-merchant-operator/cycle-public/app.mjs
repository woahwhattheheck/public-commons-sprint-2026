// MIT. Customer closing interface; all statement operations use the original local server.
import {createCustomerSetup} from './setup.mjs';
import {createCustomerDossierUi} from './customer-dossiers.mjs';
import {createServicePlannerUi} from './service-planner.mjs';
const $=id=>document.getElementById(id);
let customerSetup,customerDossiers,servicePlanner;
const state={context:null,inventory:null,selected:new Set(),selections:[],requestId:crypto.randomUUID(),cycles:[],key:null,current:null,poll:null,inventoryBusy:false,review:null};
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pretty=value=>JSON.stringify(value,null,2);
const date=value=>{
  if(!value)return 'Not recorded';
  const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))return 'Not recorded';
  return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(parsed)+' UTC';
};
const human=value=>String(value??'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,char=>char.toUpperCase());
const statusText={READY:'Ready to issue',INCOMPLETE:'In progress',COMPLETE:'Complete',UNPREPARED:'Preparing reviews',UNREADABLE:'Needs attention',REVIEWED:'Reviewed',NOT_RETAINED:'Ready to issue',SENDING:'Issuing statement',RETAINED:'Statement issued',DELIVERED:'Packet complete',EXPORT_PENDING:'Finish customer packet',RECONCILE_PENDING:'Reconcile original request',REVIEW_REQUIRED:'Source changed; review again',RUNNING:'Working',QUEUED:'Waiting for active cycle',FINISHED:'Finished',ERROR:'Needs attention'};
const active=cycle=>['RUNNING','QUEUED'].includes(cycle?.job?.phase);
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
function showError(error){$('error').textContent=error?.message??String(error);$('error').hidden=false;}
function clearError(){$('error').hidden=true;$('error').textContent='';}
async function api(path,body){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Workbench-Token':state.context.csrfToken},body:body===undefined?undefined:JSON.stringify(body)});
  let result;try{result=await response.json();}catch{throw new Error('The workbench returned an unreadable response. Refresh this page.');}
  if(!response.ok){const error=new Error(result.error?.message??'The operation could not be completed.');error.code=result.error?.code;error.status=response.status;throw error;}
  return result;
}
function draftKey(){return 'customer-closing-draft:'+state.context.draftScope;}
function saveDraft({changed=true}={}){
  if(changed)state.requestId=crypto.randomUUID();
  try{localStorage.setItem(draftKey(),JSON.stringify({label:$('cycle-label').value,selections:state.selections,requestId:state.requestId}));}catch{}
}
function restoreDraft(){
  try{const draft=JSON.parse(localStorage.getItem(draftKey())??'null');if(draft&&Array.isArray(draft.selections)){
    $('cycle-label').value=typeof draft.label==='string'?draft.label:'';
    state.selections=draft.selections;state.requestId=typeof draft.requestId==='string'?draft.requestId:crypto.randomUUID();
  }}catch{}
}
function optionList(items,label,selected,empty){
  const unavailable=selected&&!items.some(row=>row.id===selected)?'<option value="'+escape(selected)+'" selected>Saved source unavailable — choose a current source</option>':'';
  return (empty===undefined?'':'<option value="">'+escape(empty)+'</option>')+unavailable+items.map(row=>'<option value="'+escape(row.id)+'"'+(row.id===selected?' selected':'')+'>'+escape(label(row))+'</option>').join('');
}
const runLabel=row=>(row.name||'Accounting run')+' — '+date(row.completedAt||row.createdAt);
const usageLabel=row=>(row.name||'Service capture')+' — '+date(row.sourceCreatedAt);
const customerLabel=row=>row.name+' · '+row.reference;
function preserveOptions(id,items,label,empty){
  const control=$(id),old=control.value;control.innerHTML=optionList(items,label,old,empty);
  if(old&&items.some(row=>row.id===old))control.value=old;
}
function renderInventory(){
  const inventory=state.inventory;if(!inventory)return;
  preserveOptions('default-run',inventory.runs,runLabel,'Choose a completed run');
  preserveOptions('default-closing',inventory.usage,usageLabel,'No service capture');
  preserveOptions('default-opening',inventory.usage,usageLabel,'Cumulative statement');
  if(!inventory.customers.length)$('inventory-state').textContent='No customer records';
  else $('inventory-state').textContent=inventory.customers.length+' customers · '+inventory.runs.length+' completed runs · refreshed '+date(inventory.observedAt);
  renderCustomers();renderSelections();customerSetup?.inventoryChanged();servicePlanner?.inventoryChanged();
}
function visibleCustomers(){
  const query=$('customer-search').value.trim().toLowerCase();
  return (state.inventory?.customers??[]).filter(row=>!query||(row.name+' '+row.reference).toLowerCase().includes(query));
}
function renderCustomers(){
  const rows=visibleCustomers(),bindings=state.inventory?.bindings??[];
  $('customer-rows').innerHTML=rows.length?rows.map(row=>'<tr><td class="check"><input type="checkbox" data-customer="'+escape(row.id)+'" aria-label="Select '+escape(row.name)+'"'+(state.selected.has(row.id)?' checked':'')+'></td><td>'+escape(row.name)+'</td><td>'+escape(row.reference)+'</td><td>'+escape(row.orders??bindings.filter(binding=>binding.customerId===row.id).length)+'</td></tr>').join(''):'<tr><td colspan="4"><div class="empty">'+(state.inventory?.customers.length?'No customers match this search.':'Open Customers and service to add customer profiles and assign their original orders.')+'</div></td></tr>';
  const visibleSelected=rows.filter(row=>state.selected.has(row.id)).length;
  $('select-all').checked=rows.length>0&&visibleSelected===rows.length;
  $('select-all').indeterminate=visibleSelected>0&&visibleSelected<rows.length;
  $('selected-count').textContent=state.selected.size?state.selected.size+' customers selected':'No customers selected';
  $('add-customers').disabled=!state.selected.size;
}
function utcInput(value){if(!value)return '';const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString().slice(0,19):'';}
function selectionField(index,name,label,content){return '<label>'+escape(label)+'<select data-index="'+index+'" data-field="'+name+'">'+content+'</select></label>';}
function renderSelections(){
  const inventory=state.inventory;
  $('selection-count').textContent=state.selections.length?state.selections.length+' statements':'No statements added';
  $('prepare').disabled=!state.selections.length||!inventory;
  if(!state.selections.length){$('selections').innerHTML='<div class="empty">Select customers above and add them to this cycle.</div>';return;}
  if(!inventory){$('selections').innerHTML='<div class="empty">Refresh the workspace to edit the saved customer selections.</div>';return;}
  $('selections').innerHTML=state.selections.map((row,index)=>{
    const customer=inventory.customers.find(item=>item.id===row.customerId);
    const statements=inventory.statements.filter(item=>item.customerId===row.customerId&&item.status==='RETAINED');
    return '<article class="selection"><div class="selection-heading"><h3>'+escape((index+1)+'. '+(customer?customerLabel(customer):'Choose the customer'))+'</h3><div class="actions"><button type="button" data-preview="'+index+'">Review this statement</button><button type="button" data-copy="'+index+'">Add another period</button><button type="button" data-remove="'+index+'">Remove</button></div></div><div class="form-grid">'+
      selectionField(index,'customerId','Customer',optionList(inventory.customers,customerLabel,row.customerId,'Choose customer'))+
      selectionField(index,'runId','Completed accounting run',optionList(inventory.runs,runLabel,row.runId,'Choose a completed run'))+
      selectionField(index,'usageId','Closing service capture',optionList(inventory.usage,usageLabel,row.usageId,'No service capture'))+
      selectionField(index,'usageOpeningId','Opening service capture',optionList(inventory.usage,usageLabel,row.usageOpeningId,'Cumulative statement'))+
      '</div><details><summary>Settlement filter and statement correction</summary><p class="hint">Settlement bounds select purchase rows from the accounting run. Service periods use the original opening and closing captures.</p><div class="form-grid advanced">'+
      '<label>Settlement orders from (UTC)<input type="datetime-local" step="1" data-index="'+index+'" data-field="from" value="'+escape(utcInput(row.from))+'"></label>'+
      '<label>Settlement orders until (UTC)<input type="datetime-local" step="1" data-index="'+index+'" data-field="until" value="'+escape(utcInput(row.until))+'"></label>'+
      selectionField(index,'replacesId','Correct a retained statement',optionList(statements,item=>item.number+' — '+date(item.createdAt),row.replacesId,'Create a new statement'))+
      '</div></details></article>';
  }).join('');
}
function view(name){
  $('compose-view').hidden=name!=='compose';$('cycles-view').hidden=name!=='cycles';$('setup-view').hidden=name!=='setup';$('service-planner-view').hidden=name!=='service-planner';
  document.querySelectorAll('[data-view]').forEach(button=>{if(button.dataset.view===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
}
async function refreshInventory(){
  if(state.inventoryBusy)return false;state.inventoryBusy=true;$('refresh').disabled=true;clearError();notice('Reading original customers, accounting runs, service captures, and retained statements…');
  try{state.inventory=await api('/api/inventory');renderInventory();notice('Workspace records refreshed.');return true;}
  catch(error){showError(error);notice('Saved cycles are still available.');return false;}
  finally{state.inventoryBusy=false;$('refresh').disabled=false;}
}
function renderCycleList(){
  $('cycle-list').innerHTML=state.cycles.length?state.cycles.map(row=>'<button type="button" class="cycle-entry'+(row.key===state.key?' active':'')+'" data-cycle="'+escape(row.key)+'"><strong>'+escape(row.label||'Preparing customer reviews')+'</strong><small>'+escape(active(row)?statusText[row.job.phase]:statusText[row.phase]??human(row.phase))+'</small><small>'+escape(row.counts?row.counts.delivered+' of '+row.counts.total+' packets complete':date(row.preparedAt))+'</small></button>').join(''):'<div class="empty">Prepared cycles will appear here.</div>';
}
async function refreshCycles(){
  const result=await api('/api/cycles');state.cycles=result.items;renderCycleList();
}
function downloadLink(href,label){return '<a class="button-link" href="'+escape(href)+'">'+escape(label)+'</a>';}
function cycleLink(action){return '/api/cycles/'+encodeURIComponent(state.key)+'/'+action;}
function renderCycle(cycle){
  const phase=active(cycle)?statusText[cycle.job.phase]:statusText[cycle.phase]??human(cycle.phase),counts=cycle.counts??{total:0,retained:0,delivered:0,errors:0};
  let content='<div class="detail-heading"><div><h2>'+escape(cycle.label||'Preparing customer reviews')+'</h2><p class="hint">'+escape(cycle.preparedAt?'Prepared '+date(cycle.preparedAt):'Saving the complete customer reviews')+'</p></div><span class="status">'+escape(phase)+'</span></div>';
  content+='<div class="counts">'+[[counts.total,'Statements'],[counts.retained,'Issued'],[counts.delivered,'Packets complete'],[counts.errors,'Need attention']].map(([count,label])=>'<div><strong>'+escape(count)+'</strong><span>'+escape(label)+'</span></div>').join('')+'</div>';
  if(cycle.job?.error||cycle.error)content+='<div class="problem">'+escape((cycle.job?.error??cycle.error).message)+'</div>';
  if(active(cycle))content+='<p class="hint">Progress updates while the original closing operation continues. You can reopen this cycle after leaving the page.</p>';
  else if(cycle.phase==='UNPREPARED')content+='<div class="toolbar"><button class="primary" type="button" data-resume-prepare>Continue preparing reviews</button></div><p class="hint">The saved request will continue from the customer reviews already prepared.</p>';
  else if(cycle.phase!=='UNREADABLE'){
    const label=cycle.complete?'Refresh delivered statements':cycle.phase==='READY'?'Issue '+counts.total+' reviewed statements':'Resume closing cycle';
    content+='<div class="toolbar"><button class="primary" type="button" data-run>'+escape(label)+'</button>'+
      downloadLink(cycleLink('download'),'Download complete cycle')+
      '<a class="button-link" href="'+escape(cycleLink('file/register.html?view=1'))+'" target="_blank" rel="noopener">Open delivery register</a></div>';
    content+='<p class="hint">'+(cycle.complete?'Refresh retrieves the current status of these original statements and updates their customer packets.':'Review the customer statements below, then issue the remaining statements and finish their delivery files.')+'</p>';
    if(cycle.rows.some(row=>row.phase==='REVIEW_REQUIRED'))content+='<div class="problem">Some source records changed after review. Existing statements keep their original identities. Prepare new reviews for the changed rows.</div><button type="button" data-revise>Prepare changed rows</button>';
  }
  if(cycle.rows?.length){
    content+='<section class="detail-section customer-dossiers" id="customer-dossiers" aria-label="Customer handover"></section>';
    content+='<div class="detail-section table-wrap"><table><thead><tr><th>Customer</th><th>Service period</th><th>Progress</th><th>Files</th></tr></thead><tbody>';
    content+=cycle.rows.map((row,index)=>{
      const period=row.servicePeriod,capture=period?date(period.from)+' → '+date(period.until):row.usageSource?date(row.usageSource.createdAt):'Purchase statement';
      return '<tr><td>'+escape(row.customer.name)+'<small>'+escape(row.customer.reference)+' · '+escape(row.orders)+' orders</small></td><td>'+escape(capture)+(period?'<small>'+escape(period.totals.consumedUnits)+' service units consumed</small>':'')+'</td><td>'+escape(statusText[row.phase]??human(row.phase))+(row.statement?'<small>'+escape(row.statement.number)+' · '+escape(human(row.delivery?.observedStatus??row.statement.status))+'</small>':'')+(row.error?'<small class="row-note">'+escape(row.error.message)+'</small>':'')+'</td><td><div class="row-actions"><button type="button" data-review-saved="'+(index+1)+'">Review</button>'+(row.delivery?.complete&&!active(cycle)?'<a class="button-link" href="'+escape(cycleLink('file/items/'+String(index+1).padStart(6,'0')+'/delivery/index.html?view=1'))+'" target="_blank" rel="noopener">Open packet</a>'+downloadLink(cycleLink('items/'+(index+1)+'/download'),'Download'):'')+'</div></td></tr>';
    }).join('')+'</tbody></table></div>';
  }
  content+='<details class="source-details"><summary>Original cycle and source references</summary><pre>'+escape(pretty({cycleId:cycle.cycleId,workspace:cycle.workspace,requestSha256:cycle.requestSha256,manifestSha256:cycle.manifestSha256,observedAt:cycle.observedAt}))+'</pre></details>';
  if(!active(cycle)&&cycle.phase!=='UNPREPARED'&&cycle.phase!=='UNREADABLE')content+='<details class="source-details" id="cycle-files"><summary>All saved files</summary><div class="file-list" id="file-list">Open to load the complete file list.</div></details>';
  const dossierFocus=customerDossiers?.captureFocus();
  $('cycle-detail').innerHTML=content;
  customerDossiers?.mount(cycle,{focus:dossierFocus});
  $('cycle-files')?.addEventListener('toggle',async event=>{
    if(!event.target.open||event.target.dataset.loaded)return;
    try{const result=await api('/api/cycles/'+encodeURIComponent(cycle.key)+'/files');if(state.key!==cycle.key||$('cycle-files')!==event.target)return;$('file-list').innerHTML=result.items.map(file=>'<div><a href="'+escape(file.href)+'">'+escape(file.name)+'</a><small>'+escape(file.bytes.toLocaleString())+' bytes</small></div>').join('');event.target.dataset.loaded='true';}catch(error){showError(error);}
  });
}
async function loadCycle(key,{poll=false}={}){
  if(!poll){clearTimeout(state.poll);state.key=key;state.current=null;clearError();$('cycle-detail').innerHTML='<div class="empty">Loading closing cycle…</div>';renderCycleList();}
  try{
    const cycle=await api('/api/cycles/'+encodeURIComponent(key));if(state.key!==key)return;
    state.current=cycle;const found=state.cycles.findIndex(row=>row.key===key);
    if(found>=0)state.cycles[found]=cycle;else state.cycles.unshift(cycle);
    renderCycleList();renderCycle(cycle);
    if(active(cycle)){clearTimeout(state.poll);state.poll=setTimeout(()=>loadCycle(key,{poll:true}),1500);}
  }catch(error){showError(error);if(poll&&state.key===key){state.poll=setTimeout(()=>loadCycle(key,{poll:true}),5000);}}
}
function simpleValue(value){
  if(value===null||value===undefined||value==='')return 'Not recorded';
  if(typeof value==='object')return pretty(value);
  return String(value);
}
function dataTable(parent,title,rows,columns){
  if(!Array.isArray(rows)||!rows.length)return;
  const section=document.createElement('section');section.className='review-section';parent.append(section);
  const heading=document.createElement('h3');heading.textContent=title+' ('+rows.length+')';section.append(heading);
  const tableBox=document.createElement('div');tableBox.className='table-wrap data-table';section.append(tableBox);
  const pager=document.createElement('div');pager.className='pagination';section.append(pager);let page=0;
  const render=()=>{
    const slice=rows.slice(page*50,page*50+50);
    tableBox.innerHTML='<table><thead><tr>'+columns.map(column=>'<th>'+escape(column.label)+'</th>').join('')+'</tr></thead><tbody>'+slice.map(row=>'<tr>'+columns.map(column=>{
      const value=column.value(row);return '<td>'+(value!==null&&typeof value==='object'?'<details><summary>Details</summary><pre class="json-record">'+escape(pretty(value))+'</pre></details>':escape(simpleValue(value)))+'</td>';
    }).join('')+'</tr>').join('')+'</tbody></table>';
    pager.replaceChildren();if(rows.length<=50)return;
    const previous=document.createElement('button');previous.type='button';previous.textContent='Previous';previous.disabled=page===0;previous.onclick=()=>{page--;render();};
    const label=document.createElement('span');label.textContent=(page*50+1)+'–'+Math.min(rows.length,page*50+50)+' of '+rows.length;
    const next=document.createElement('button');next.type='button';next.textContent='Next';next.disabled=(page+1)*50>=rows.length;next.onclick=()=>{page++;render();};
    pager.append(previous,label,next);
  };render();
}
function originalColumns(rows){
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const useful=keys.filter(key=>!/(?:sha256|digest|manifest|^id$|Id$|source|requestId)/.test(key));
  return useful.slice(0,6).map(key=>({label:human(key),value:row=>row[key]})).concat([{label:'Complete original row',value:row=>row}]);
}
function openReview(review){
  state.review=review;const draft=review.draft,period=draft.servicePeriod;
  $('review-title').textContent=draft.customer.name;
  const target=$('review-content');
  target.innerHTML='<div class="review-meta"><span>'+escape(draft.customer.reference)+'</span><span>Accounting run completed '+escape(date(draft.source.reportCreatedAt))+'</span><span>Review revision '+escape(review.revision)+'</span></div>'+
    '<div class="counts">'+[[draft.totals.orders,'Orders'],[draft.totals.serviceOrders,'Service orders'],[draft.totals.excludedOrders,'Excluded orders'],[draft.totals.requiringReconciliation,'Need reconciliation']].map(([count,label])=>'<div><strong>'+escape(count)+'</strong><span>'+escape(label)+'</span></div>').join('')+'</div>'+
    '<p class="hint">Known merchant quoted USD: '+escape(draft.totals.merchantQuotedUsd.knownTotal)+' across '+escape(draft.totals.merchantQuotedUsd.knownOrders)+' orders. '+escape(draft.totals.merchantQuotedUsd.unknownOrders)+' orders have no recorded quote.</p>';
  if(period){
    const section=document.createElement('section');section.className='review-section';
    section.innerHTML='<h3>Service period</h3><p>'+escape(date(period.from))+' → '+escape(date(period.until))+'</p><p class="hint">'+escape(period.planLabel)+' · Order '+escape(period.orderRef)+'</p><div class="review-grid"><div class="table-wrap"><table><thead><tr><th>Service units</th><th class="number">Opening</th><th class="number">Closing</th></tr></thead><tbody>'+
      [['unitsPurchased','Purchased'],['unitsUsed','Consumed'],['unitsReserved','Reserved'],['unitsRemaining','Available']].map(([key,label])=>'<tr><td>'+label+'</td><td class="number">'+escape(period.opening[key])+'</td><td class="number">'+escape(period.closing[key])+'</td></tr>').join('')+'</tbody></table></div><div class="table-wrap"><table><thead><tr><th>Period movement</th><th class="number">Units or calls</th></tr></thead><tbody>'+
      [['admittedUnits','Admitted units'],['consumedUnits','Consumed units'],['releasedUnits','Released units'],['reservedDeltaUnits','Change in reserved units'],['resultRecoveries','Saved results recovered'],['carriedReservations','Carried reservations']].map(([key,label])=>'<tr><td>'+label+'</td><td class="number">'+escape(period.totals[key])+'</td></tr>').join('')+'</tbody></table></div></div>';
    target.append(section);
    dataTable(target,'Service routes',period.routes,[{label:'Method',value:row=>row.method},{label:'Route',value:row=>row.path},{label:'Opening calls',value:row=>row.openingCalls},{label:'Closing calls',value:row=>row.closingCalls},{label:'Consumed units',value:row=>row.consumedUnits},{label:'Released units',value:row=>row.releasedUnits}]);
    dataTable(target,'Service calls',period.calls,[{label:'Method',value:row=>row.method},{label:'Route',value:row=>row.path},{label:'Activity',value:row=>human(row.kind)},{label:'Current state',value:row=>human(row.closing?.status)},{label:'Consumed units',value:row=>row.consumedUnits},{label:'Released units',value:row=>row.releasedUnits},{label:'Original request',value:row=>row}]);
  }else if(draft.source.usage){const p=document.createElement('p');p.className='review-section';p.textContent='Cumulative service capture: '+date(draft.source.usage.createdAt);target.append(p);}
  dataTable(target,'Purchase orders',draft.items,originalColumns(draft.items));
  dataTable(target,'Excluded orders',draft.excluded,originalColumns(draft.excluded));
  dataTable(target,'Asset totals',draft.totals.byAsset,originalColumns(draft.totals.byAsset));
  const details=document.createElement('details');details.className='source-details';
  details.innerHTML='<summary>Complete original review and source references</summary><button type="button" id="download-review">Download review JSON</button><pre>'+escape(pretty(review))+'</pre>';target.append(details);
  $('download-review').onclick=()=>{
    const blob=new Blob([pretty(review)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='customer-statement-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  if(!$('review-dialog').open)$('review-dialog').showModal();$('review-dialog').scrollTop=0;
}
async function prepareCycle(){
  clearError();const label=$('cycle-label').value.trim();if(!label){showError(new Error('Name this closing cycle.'));$('cycle-label').focus();return;}
  $('prepare').disabled=true;saveDraft({changed:false});notice('Preparing and saving every complete customer statement review…');
  try{
    const result=await api('/api/cycles',{requestId:state.requestId,label,selections:state.selections});
    state.key=result.key;view('cycles');await refreshCycles();await loadCycle(result.key);notice('The closing cycle is preparing. Its complete customer reviews will appear here.');
  }catch(error){showError(error);notice('Your customer selections are saved in this browser. Retrying this preparation keeps its request identity.');}
  finally{$('prepare').disabled=!state.selections.length;}
}
$('refresh').addEventListener('click',refreshInventory);
$('customer-search').addEventListener('input',renderCustomers);
$('cycle-label').addEventListener('input',()=>saveDraft());
$('select-all').addEventListener('change',event=>{for(const row of visibleCustomers()){if(event.target.checked)state.selected.add(row.id);else state.selected.delete(row.id);}renderCustomers();});
$('customer-rows').addEventListener('change',event=>{const id=event.target.dataset.customer;if(!id)return;if(event.target.checked)state.selected.add(id);else state.selected.delete(id);renderCustomers();});
$('add-customers').addEventListener('click',()=>{
  const runId=$('default-run').value;if(!runId){showError(new Error('Choose a completed accounting run.'));$('default-run').focus();return;}
  clearError();for(const customerId of state.selected)state.selections.push({customerId,runId,usageId:$('default-closing').value||null,usageOpeningId:$('default-opening').value||null,replacesId:null});
  state.selected.clear();saveDraft();renderCustomers();renderSelections();
});
$('selections').addEventListener('change',event=>{
  const {index,field}=event.target.dataset;if(index===undefined||!field)return;
  const row=state.selections[Number(index)];if(!row)return;
  const value=event.target.value;
  if(field==='from'||field==='until'){if(value)row[field]=new Date(value+'Z').toISOString();else delete row[field];}
  else row[field]=value||null;
  if(field==='customerId')row.replacesId=null;
  saveDraft();if(field==='customerId')renderSelections();
});
$('selections').addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.remove!==undefined){state.selections.splice(Number(button.dataset.remove),1);saveDraft();renderSelections();}
  else if(button.dataset.copy!==undefined){const index=Number(button.dataset.copy);state.selections.splice(index+1,0,{...state.selections[index],replacesId:null});saveDraft();renderSelections();notice('Another period row was added. Choose its opening and closing captures.');}
  else if(button.dataset.preview!==undefined){
    button.disabled=true;clearError();try{openReview(await api('/api/preview',{selection:state.selections[Number(button.dataset.preview)]}));}catch(error){showError(error);}finally{button.disabled=false;}
  }
});
$('prepare').addEventListener('click',prepareCycle);
$('close-review').addEventListener('click',()=>$('review-dialog').close());
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',async()=>{
  view(button.dataset.view);if(button.dataset.view==='service-planner')try{await servicePlanner.show();}catch(error){showError(error);}if(button.dataset.view==='setup')try{await customerSetup.show();}catch(error){showError(error);}if(button.dataset.view==='cycles')try{await refreshCycles();if(state.key)await loadCycle(state.key);}catch(error){showError(error);}
}));
$('reload-cycles').addEventListener('click',async()=>{try{await refreshCycles();if(state.key)await loadCycle(state.key);}catch(error){showError(error);}});
$('cycle-list').addEventListener('click',event=>{const button=event.target.closest('[data-cycle]');if(button)loadCycle(button.dataset.cycle);});
$('cycle-detail').addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||button.closest('#customer-dossiers'))return;clearError();button.disabled=true;
  try{
    if(button.hasAttribute('data-run')){await api(cycleLink('run'),{execute:true});await loadCycle(state.key);}
    else if(button.hasAttribute('data-resume-prepare')){await api(cycleLink('prepare'),{});await loadCycle(state.key);}
    else if(button.dataset.reviewSaved){openReview(await api(cycleLink('items/'+button.dataset.reviewSaved+'/review')));}
    else if(button.hasAttribute('data-revise')){
      state.selections=state.current.rows.filter(row=>row.phase==='REVIEW_REQUIRED').map(row=>({...row.intent}));
      $('cycle-label').value=(state.current.label+' — revised').slice(0,200);saveDraft();renderSelections();view('compose');
      notice('Changed rows are ready for a new review. Choose the current source captures before preparing.');
    }
  }catch(error){showError(error);}finally{button.disabled=false;}
});
window.addEventListener('pagehide',()=>clearTimeout(state.poll));
customerDossiers=createCustomerDossierUi({api,notice,showError,clearError});
customerSetup=createCustomerSetup({getState:()=>state,api,notice,showError,clearError,refreshInventory,
  async addCorrection(original){
    if(await refreshInventory()===false)throw new Error('Refresh the workspace before preparing this correction.');
    const current=state.inventory.statements.find(row=>row.id===original.id);
    if(current?.status!=='RETAINED')throw new Error('This statement has already changed. Open its current record.');
    const row={customerId:current.customerId,runId:current.runId,usageId:current.usageId??null,replacesId:current.id};
    if(current.usageOpeningId)row.usageOpeningId=current.usageOpeningId;
    if(current.from!==null&&current.until!==null){row.from=current.from;row.until=current.until;}
    state.selections.push(row);$('cycle-label').value=$('cycle-label').value||('Correction of '+current.number).slice(0,200);
    saveDraft();renderSelections();view('compose');$('selections').scrollIntoView({block:'start'});
    notice('The original statement was added for correction. Choose its current sources and review the complete replacement.');
  }
});
servicePlanner=createServicePlannerUi({getState:()=>state,api,notice,showError,clearError,openReview,
  async openCycle(key){state.key=key;view('cycles');await refreshCycles();await loadCycle(key);},
  async showSetup(){view('setup');await customerSetup.show();}
});
async function start(){
  try{
    state.context=await api('/api/context');$('workspace-name').textContent=state.context.workspace;$('operator-name').textContent=state.context.actor;
    $('storage-location').textContent='Saved cycles: '+state.context.directory;restoreDraft();renderSelections();
    await Promise.allSettled([refreshInventory(),refreshCycles().catch(showError)]);
  }catch(error){showError(error);$('workspace-name').textContent='Connection unavailable';}
}
start();
