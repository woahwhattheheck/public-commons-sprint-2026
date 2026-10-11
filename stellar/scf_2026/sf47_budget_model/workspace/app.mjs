import { mountOperations } from './operations.mjs';
const $ = (selector, root = document) => root.querySelector(selector);
const clone = value => structuredClone(value);
function sourceBase64(buffer) {
  const bytes=new Uint8Array(buffer);let binary='';
  for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(binary);
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const money = value => value === null || value === undefined || value === '' ? 'Not entered' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(value));
const amount = value => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(value || 0));
const label = value => String(value).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./, character => character.toUpperCase());
const tabs = [['overview','Overview'],['work','Work packages'],['milestones','Milestones'],['staffing','Staffing'],['payments','Payment timing'],['delivery','Delivery plan'],['history','Saved versions'],['operations','Delivery operations']];
const state = {token:null,plans:[],current:null,draft:null,tab:'overview',dirty:false,stale:false,busy:false,history:[],selectedHistory:null};
let controlId = 0;
let operationsView = null;
function closeOperations() {operationsView?.dispose();operationsView=null;}
let requestIds = {};
try { requestIds = JSON.parse(sessionStorage.getItem('sf47.requests') || '{}'); } catch {}
function inform(message, error = false) {
  const node = $('#message'); node.textContent = message; node.dataset.error = String(error); node.setAttribute('role',error?'alert':'status');
}
function busy(value) {
  state.busy = value; $('#workbench').setAttribute('aria-busy',String(value));
  for(const control of document.querySelectorAll('#workbench button,#workbench input:not([type=file]),#workbench select,#workbench textarea')) {
    control.disabled = value || control.dataset.fixedDisabled === 'true' || control.dataset.action === 'save' && !state.dirty;
  }
}
async function api(path, body, options = {}) {
  const headers = {authorization:'Bearer ' + state.token,...options.headers};
  if(body !== undefined && !options.raw) headers['content-type'] = 'application/json';
  const response = await fetch(path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:options.raw?body:JSON.stringify(body)})});
  if(options.download && response.ok) return response;
  let result;try {result = await response.json();} catch {throw new Error('The server response was interrupted. Reopen the saved plan to continue.');}
  if(!response.ok) {const error = new Error(result.error?.message || 'The operation did not complete.'); error.code=result.error?.code;error.status=response.status;throw error;}
  return result;
}
async function mutationId(action, payload) {
  const bytes = new TextEncoder().encode(JSON.stringify({action,payload}));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), value=>value.toString(16).padStart(2,'0')).join('');
  requestIds[hash] ||= crypto.randomUUID();
  const keys = Object.keys(requestIds); while(keys.length > 100) delete requestIds[keys.shift()];
  try {sessionStorage.setItem('sf47.requests',JSON.stringify(requestIds));} catch {}
  return requestIds[hash];
}
function field(title, path, value, options = {}) {
  const id = 'field-' + (++controlId), data = ' id="' + id + '" data-path="' + esc(JSON.stringify(path)) + '" data-kind="' + (options.kind || 'text') + '"';
  let control;
  if(options.choices) control = '<select' + data + '>' + options.choices.map(([key,name])=>'<option value="' + esc(key) + '"' + (String(key)===String(value)?' selected':'') + '>' + esc(name) + '</option>').join('') + '</select>';
  else if(options.area) control = '<textarea' + data + ' rows="' + (options.rows || 3) + '" maxlength="' + (options.max || 12000) + '">' + esc(value) + '</textarea>';
  else control = '<input' + data + ' type="' + (options.type || 'text') + '" value="' + esc(value) + '" maxlength="' + (options.max || 500) + '"' + (options.type==='number'?' step="' + (options.step || '1') + '"':'') + (options.readonly?' readonly':'') + '>';
  return '<label for="' + id + '"' + (options.wide?' class="span-all"':'') + '>' + esc(title) + control + (options.help?'<span class="help">' + esc(options.help) + '</span>':'') + '</label>';
}
function heading(title, description, action = '') {
  return '<div class="section-heading"><div><h2>' + esc(title) + '</h2><p class="help">' + esc(description) + '</p></div>' + action + '</div>';
}
function button(title, action, extra = '') {return '<button type="button" data-action="' + action + '"' + extra + '>' + esc(title) + '</button>';}
function stat(title, value, note) {return '<div class="card"><span>' + esc(title) + '</span><strong>' + esc(value) + '</strong><small>' + esc(note || '') + '</small></div>';}
function table(headers, rows, classes = []) {
  return '<div class="table-wrap"><table><thead><tr>' + headers.map((name,i)=>'<th scope="col" class="' + (classes[i] || '') + '">' + esc(name) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(cells=>'<tr>' + cells.map((cell,i)=>'<td class="' + (classes[i] || '') + '">' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function draftHint() {return state.stale ? '<div class="notice">The figures below are from the last calculation. Calculate this draft to refresh the cash and capacity review.</div>' : '';}
function costs() {return state.draft.scenario.future_costs;}
function pathValue(parts) {return parts.reduce((value,key)=>value?.[key],state.draft);}
function setPath(parts, value) {
  let current = state.draft;for(let i=0;i<parts.length-1;i++){current[parts[i]] ??= {};current=current[parts[i]];}current[parts.at(-1)]=value;
}
function changed() {state.dirty=true;state.stale=true;updateBar();}
function updateBar() {
  if(!state.current) return;
  $('#revision-label').textContent = state.current.name + ' · Revision ' + state.current.revision;
  $('#draft-state').textContent = state.dirty ? (state.stale?'Edited · calculation pending':'Calculated draft · unsaved') : 'Saved revision ' + state.current.revision;
  $('#revision-label').title=state.current.contentSha256;
  busy(state.busy);
}
function amountParts(raw) {
  const match = String(raw ?? '').trim().match(/^(\d+)(?:\.(\d*))?$/);if(!match) throw new Error('Enter nonnegative decimal hours, rates and amounts before matching the request.');
  return {units:BigInt(match[1]+(match[2]||'')),scale:(match[2]||'').length};
}
function asCents(parts) {
  if(parts.scale <= 2) return parts.units * 10n**BigInt(2-parts.scale);
  const divisor=10n**BigInt(parts.scale-2);return (parts.units + divisor/2n)/divisor;
}
function plannedCents(item) {
  if(state.draft.planning.pricing[item.id] === 'hours') {
    const hours=amountParts(item.estimated_hours),rate=amountParts(item.assumed_hourly_rate_usd);
    return asCents({units:hours.units*rate.units,scale:hours.scale+rate.scale});
  }
  return asCents(amountParts(item.amount_usd));
}
function moneyString(cents) {return (cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');}
function packageName(item) {return String(item.id).replace(/^T[123]-/,'').replace(/-/g,' ').replace(/^./,character=>character.toUpperCase());}
function chart(days) {
  const width=900,height=290,left=77,right=20,top=22,bottom=40;
  const maxDay=Math.max(1,...days.map(row=>row.day)),maxValue=Math.max(1,...days.flatMap(row=>[Number(row.accruedUsd),Number(row.conditionalInflowUsd),Number(row.plannedOutflowUsd)]));
  const x=value=>left+value/maxDay*(width-left-right),y=value=>height-bottom-value/maxValue*(height-top-bottom);
  const line=key=>days.map((row,index)=>(index?'L':'M')+x(row.day).toFixed(2)+','+y(Number(row[key])).toFixed(2)).join(' ');
  let grid='';
  for(let i=0;i<=4;i++){const v=maxValue*i/4,yy=y(v);grid+='<line x1="'+left+'" x2="'+(width-right)+'" y1="'+yy+'" y2="'+yy+'" stroke="#ddd"/><text x="'+(left-10)+'" y="'+(yy+4)+'" text-anchor="end" font-size="11" fill="#555">'+esc(money(v))+'</text>';}
  for(let i=0;i<=4;i++){const d=Math.round(maxDay*i/4);grid+='<text x="'+x(d)+'" y="'+(height-16)+'" text-anchor="middle" font-size="11" fill="#555">Day '+d+'</text>';}
  return '<figure class="cash-chart"><svg viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="cash-chart-title"><title id="cash-chart-title">Daily planned outflows, conditional grant inflows and accrued work cost</title>'+grid+
    '<path d="'+line('accruedUsd')+'" fill="none" stroke="#999" stroke-width="2" stroke-dasharray="2 4"/><path d="'+line('plannedOutflowUsd')+'" fill="none" stroke="#666" stroke-width="2.5" stroke-dasharray="8 5"/><path d="'+line('conditionalInflowUsd')+'" fill="none" stroke="#222" stroke-width="2.5"/></svg><div class="chart-legend"><span>Conditional grant inflows</span><span class="outflow">Planned payments</span><span class="accrual">Accrued work cost</span></div><figcaption>Day zero is the planning acceptance date. Cash timing uses the complete work-package amounts and the payment schedules entered in this draft.</figcaption></figure>';
}
function overview() {
  const {scenario,planning,report}=state.draft,r=report,cash=r.cash,native=r.originalModel;
  return heading('Budget and delivery overview','Review the complete work plan, conditional program inflows and the timing of contributor payments.')+draftHint()+
    '<div class="cards">'+stat('Requested development budget',money(native.award_request_usd),r.capacity.totalHours+' estimated hours')+
    stat('Peak planned cash gap',money(cash.peakCashGapUsd),'Day '+cash.peakCashGapDay)+
    stat('Working-capital input',money(cash.capitalInputUsd),cash.gapAfterCapitalInputUsd===null?'Enter a planning input below':'Remaining peak need '+money(cash.gapAfterCapitalInputUsd))+
    stat('Unassigned effort',amount(r.capacity.unassignedHours)+' hours',costs().length+' work packages')+'</div>'+
    '<section class="panel"><h3>Daily cost and payment timing</h3>'+chart(cash.days)+'<div class="button-row">'+button('Download saved daily CSV','daily')+button('Download saved scenario JSON','scenario')+'</div></section>'+
    '<section class="panel"><h3>Program payment-delay comparison</h3><p class="help">Each row runs the original calculator with the same work schedule and a common milestone review/payment lag. Planned-payment gaps also use the contributor schedules from this draft.</p>'+
    table(['Assumed lag','Native accrual gap','Planned-payment gap','Last program payment',''],r.lagComparisons.map(row=>row.valid?
      [row.lagDays+' days',money(row.nativePeakUsd)+'<br><span class="small">Day '+row.nativePeakDay+'</span>',money(row.cashPeakUsd)+'<br><span class="small">Day '+row.cashPeakDay+'</span>','Day '+row.lastPaymentDay,button('Use '+row.lagDays+' days','use-lag',' data-lag="'+row.lagDays+'"')]:
      [row.lagDays+' days','<span class="small">'+esc(row.error)+'</span>','—','—','']),['','numeric','numeric','',''])+'</section>'+
    '<section class="panel"><h3>Planning context</h3><div class="grid">'+
    field('Scenario description',['scenario','scenario_name'],scenario.scenario_name,{wide:true})+
    field('Day-zero calendar date',['planning','calendarStart'],planning.calendarStart,{type:'date',help:'Optional calendar anchor for modeled day offsets.'})+
    field('Working-capital planning input · USD',['planning','capitalUsd'],planning.capitalUsd,{help:'Leave blank until you have an amount to evaluate.'})+
    field('Working-capital source / timing note',['planning','capitalNote'],planning.capitalNote,{area:true,wide:true})+
    field('Planning notes',['planning','notes'],planning.notes,{area:true,wide:true})+'</div></section>'+
    '<section class="panel"><h3>Source and current revision</h3><dl class="source-grid"><dt>Scenario source</dt><dd>'+esc(state.current.source.filename)+'</dd><dt>Source SHA-256</dt><dd class="code">'+esc(state.current.source.sha256)+'</dd><dt>Calculator SHA-256</dt><dd class="code">'+esc(r.calculatorSha256)+'</dd><dt>Saved at</dt><dd>'+esc(state.current.savedAt)+'</dd><dt>Application state in source</dt><dd>'+esc(label(scenario.application_state || 'Not recorded'))+'</dd></dl></section>';
}
function work() {
  const scenario=state.draft.scenario,planning=state.draft.planning;
  let sum;try {sum=money(moneyString(costs().reduce((value,row)=>value+plannedCents(row),0n)));} catch {sum='Enter complete amounts';}
  return heading('Remaining work packages','Edit effort, pricing and delivery outcomes. Existing source metadata stays attached to each package.',button('Add work package','add-cost'))+
    '<section class="panel"><div class="grid">'+field('Requested total · USD',['scenario','award_request_usd'],scenario.award_request_usd)+field('Project end day',['scenario','project_end_day'],scenario.project_end_day,{type:'number',kind:'integer'})+'</div><div class="total-line"><span>Calculated package total <strong>'+esc(sum)+'</strong></span>'+button('Match request to package costs','match-total')+'</div></section>'+
    costs().map((item,index)=>{
      const p=['scenario','future_costs',index],pricing=planning.pricing[item.id];
      let price;try {price=money(moneyString(plannedCents(item)));} catch {price='Incomplete';}
      return '<details class="work-package" open><summary><span class="title"><strong>'+esc(packageName(item))+'</strong><span>'+esc(item.id)+' · Tranche '+item.tranche+'</span></span><span class="amount">'+esc(price)+'</span></summary><div class="package-body"><div class="day-row">'+
      field('Tranche',[...p,'tranche'],item.tranche,{kind:'integer',choices:[[1,'1'],[2,'2'],[3,'3']]})+
      field('Start day',[...p,'start_day'],item.start_day,{type:'number',kind:'integer'})+
      field('Finish day',[...p,'end_day'],item.end_day,{type:'number',kind:'integer'})+
      field('Cost category',[...p,'category'],item.category,{choices:[['core-development','Core development'],['frontend-ux','Frontend / UX'],['verification','Verification'],['release','Release']]})+
      field('Pricing basis',['planning','pricing',item.id],pricing,{choices:[['hours','Hours × rate'],['fixed','Fixed amount']]})+
      field('Estimated hours',[...p,'estimated_hours'],item.estimated_hours,{type:'number',step:'.01'})+
      field('Hourly rate · USD',[...p,'assumed_hourly_rate_usd'],item.assumed_hourly_rate_usd || '',{type:'number',step:'.01',readonly:pricing!=='hours'})+
      field('Package amount · USD',[...p,'amount_usd'],pricing==='hours'?(()=>{try{return moneyString(plannedCents(item));}catch{return '';}})():item.amount_usd,{type:'number',step:'.01',readonly:pricing==='hours'})+
      '</div><div class="grid">'+field('Remaining deployment / integration work',[...p,'remaining_work'],item.remaining_work || '',{area:true,wide:true})+
      field('Measurable delivery outcome',[...p,'measurable_proof'],item.measurable_proof,{area:true,wide:true})+'</div><div class="button-row">'+button('Remove package','remove-cost',' data-index="'+index+'"')+'</div></div></details>';
    }).join('');
}
function milestones() {
  const scenario=state.draft.scenario;
  return heading('Milestone schedule','Set the three submission days, their assumed review/payment lags and the outcomes the work must deliver.')+
    '<div class="notice">The original model keeps program payments sequential. The final submission must match the project end day; every package must finish by its assigned tranche.</div>'+
    scenario.milestones.map((row,index)=>{
      const p=['scenario','milestones',index];
      return '<section class="panel"><h3>Tranche '+row.tranche+'</h3><div class="grid-three">'+
        field('Submission day',[...p,'submit_day'],row.submit_day,{type:'number',kind:'integer'})+
        field('Assumed review/payment lag · days',[...p,'review_and_payment_lag_days'],row.review_and_payment_lag_days,{type:'number',kind:'integer'})+
        '<div><p class="eyebrow">Modeled payment</p><strong>Day '+esc(Number(row.submit_day)+Number(row.review_and_payment_lag_days))+'</strong></div>'+
        field('Deliverable',[...p,'deliverable'],row.deliverable,{area:true,wide:true})+
        field('Measurable outcome / acceptance material',[...p,'measurable_proof'],row.measurable_proof,{area:true,wide:true})+'</div></section>';
    }).join('')+
    '<section class="panel"><h3>Current conditional payout schedule</h3>'+draftHint()+table(['Payout','Share','USD','Modeled receipt day'],state.draft.report.originalModel.payouts.map((row,index)=>[index===0?'Initial acceptance':'Tranche '+index,['10%','20%','30%','40%'][index],money(row.usd),'Day '+row.hypothetical_paid_day]),['','','numeric',''])+'</section>';
}
function staffing() {
  const p=state.draft.planning,r=state.draft.report.capacity;
  return heading('Contributors and capacity','Allocate the actual remaining effort and compare each contributor’s entered weekly capacity with overlapping package assignments.',button('Add contributor','add-person'))+
    '<p class="help">Weekly equivalents distribute hours over each package’s inclusive calendar-day span. Enter the source of each capacity assumption in the contributor note.</p>'+
    (p.contributors.length?p.contributors.map((person,index)=>{
      const prefix=['planning','contributors',index];
      return '<section class="panel"><div class="grid-three">'+field('Contributor name',prefix.concat('name'),person.name)+field('Available hours per week',prefix.concat('weeklyHours'),person.weeklyHours,{type:'number',step:'.01'})+
        '<div class="row-actions">'+button('Remove contributor','remove-person',' data-index="'+index+'"')+'</div>'+
        field('Capacity / rate source or agreement note',prefix.concat('note'),person.note,{area:true,wide:true})+'</div></section>';
    }).join(''):'<div class="empty">Add the people or delivery roles being planned for this work.</div>')+
    '<section class="panel"><div class="section-heading"><div><h3>Package assignments</h3><p class="help">Split a package across contributors by adding more than one assignment. Allocations retain the package’s original start and finish days.</p></div>'+
      button('Add assignment','add-assignment',p.contributors.length?'':' data-fixed-disabled="true" disabled')+'</div>'+
      (p.assignments.length?table(['Work package','Contributor','Hours',''],p.assignments.map((row,index)=>{
        const prefix=['planning','assignments',index];
        return [field('Work package',prefix.concat('costId'),row.costId,{choices:costs().map(item=>[item.id,packageName(item)])}),field('Contributor',prefix.concat('contributorId'),row.contributorId,{choices:p.contributors.map(item=>[item.id,item.name || item.id])}),field('Assigned hours',prefix.concat('hours'),row.hours,{type:'number',step:'.01'}),button('Remove','remove-assignment',' data-index="'+index+'"')];
      })):'<p class="unassigned">The current plan has no entered contributor assignments.</p>')+'</section>'+
    '<section class="panel"><h3>Capacity review</h3>'+draftHint()+
    (r.contributors.length?table(['Contributor','Assigned hours','Weekly capacity','Peak weekly requirement','Days above capacity'],r.contributors.map(row=>[esc(row.name),amount(row.totalHours),amount(row.weeklyCapacityHours),amount(row.peakWeeklyRequiredHours),row.overloadedDays?'<strong>'+row.overloadedDays+'</strong><br><span class="small">Day '+row.firstOverloadedDay+'–'+row.lastOverloadedDay+'</span>':'0']),['','numeric','numeric','numeric','']):'')+
    '<p class="unassigned">'+amount(r.unassignedHours)+' of '+amount(r.totalHours)+' hours remain unassigned.</p>'+
    table(['Package','Unassigned hours'],r.unassigned.map(row=>[esc(packageName({id:row.costId})),amount(row.hours)]),['','numeric'])+'</section>';
}
function payments() {
  const p=state.draft.planning;
  return heading('Contributor payment timing','Plan when each complete work-package amount is paid. Deferred amounts remain part of the plan and appear as accrued unpaid cost until their entered payment day.')+
    '<div class="notice">Payment timing changes the cash requirement. It keeps each package’s full price and the source program payout rules.</div>'+
    costs().map((item,index)=>{
      const payment=p.payments[item.id] || {mode:'accrual',note:''},prefix=['planning','payments',item.id];
      let body='<div class="grid">'+field('Payment timing',prefix.concat('mode'),payment.mode,{choices:[['accrual','Pay evenly while work accrues'],['completion','Pay after package completion'],['installments','Enter dated installments']]})+
        '<div><p class="eyebrow">Complete package amount</p><strong>'+money(item.amount_usd)+'</strong><p class="help">Work days '+item.start_day+'–'+item.end_day+'</p></div>';
      if(payment.mode==='completion') body+=field('Days after package completion',prefix.concat('lagDays'),payment.lagDays || 0,{type:'number',kind:'integer',help:'Payment falls on day '+(Number(item.end_day)+Number(payment.lagDays || 0))+'.'});
      body+=field('Payment timing source / agreement note',prefix.concat('note'),payment.note || '',{area:true,wide:true})+'</div>';
      if(payment.mode==='installments') body+=table(['Payment day','USD',''],(payment.installments || []).map((row,i)=>[field('Payment day',prefix.concat('installments',i,'day'),row.day,{type:'number',kind:'integer'}),field('Installment amount · USD',prefix.concat('installments',i,'usd'),row.usd,{type:'number',step:'.01'}),button('Remove','remove-installment',' data-index="'+index+'" data-installment="'+i+'"')]))+'<div class="button-row">'+button('Add installment','add-installment',' data-index="'+index+'"')+'</div>';
      return '<section class="panel"><h3>'+esc(packageName(item))+'</h3>'+body+'</section>';
    }).join('');
}
function delivery() {
  const original=state.draft.report.deliveryPlan;
  if(!original) return heading('Deployment acceptance plan','This scenario does not contain a structured deployment acceptance plan.')+'<p>Import a complete source scenario to retain its native deployment targets and operating record joins.</p>';
  const missing=(original.targets || []).flatMap(row=>row.cost_ids || []).filter(id=>!costs().some(row=>row.id===id));
  return heading('Deployment and acceptance plan','The complete source plan stays attached to every revision and export. Add accountable owners and scheduling notes alongside its proposed targets.')+
    (missing.length?'<div class="notice">This local budget revision removed packages still referenced in the source plan: '+esc([...new Set(missing)].join(', '))+'. Record the intended scope change and reconcile the original acceptance source before adopting this revision.</div>':'')+
    (original.targets || []).map(target=>'<section class="panel delivery-target"><h3>Tranche '+target.tranche+' · Proposed operating outcome</h3><p>'+esc(target.outcome)+'</p>'+
      '<dl>'+Object.entries(target.target_counts || {}).map(([key,value])=>'<dt>'+esc(label(key))+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>'+
      '<p class="help">Source window: '+esc(Object.entries(target.proposed_window || {}).map(([key,value])=>label(key)+': '+value).join(' · '))+'</p>'+
      '<h4>Original operating records</h4><ul class="list">'+(target.native_records || []).map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>'+
      '<p class="help">'+esc(target.timing_measurement || '')+'</p>'+field('Accountable owner, planned dates and source notes',['planning','deliveryNotes',String(target.tranche)],state.draft.planning.deliveryNotes[String(target.tranche)] || '',{area:true})+'</section>').join('')+
    '<section class="panel"><h3>Source measurement and receiving contracts</h3>'+ (original.record_joins || []).map(row=>'<details class="json-details"><summary>'+esc(row.measurement)+'</summary><p>'+esc(row.join)+'</p><ul class="list">'+(row.source_paths || []).map(value=>'<li class="code">'+esc(value)+'</li>').join('')+'</ul></details>').join('')+'</section>'+
    '<details class="json-details panel"><summary>Complete retained source plan</summary><pre>'+esc(JSON.stringify(original,null,2))+'</pre></details>';
}
function history() {
  const chosen=state.selectedHistory;
  return heading('Saved revisions and reopening','Every save appends a retained version. Restoring an earlier revision appends another version and keeps intervening work available.')+
    table(['Revision','Saved at','Change note',''],state.history.map(row=>['<strong>'+row.revision+'</strong>',esc(new Date(row.savedAt).toLocaleString()),esc(row.note),button('Review','history-view',' data-revision="'+row.revision+'"')]))+
    (chosen?'<section class="panel"><div class="section-heading"><div><h3>Revision '+chosen.revision+'</h3><p class="help">'+esc(chosen.note)+'</p></div>'+button('Restore as a new revision','restore',' data-revision="'+chosen.revision+'"')+'</div><div class="cards">'+
      stat('Request',money(chosen.report.originalModel.award_request_usd),chosen.report.capacity.totalHours+' estimated hours')+
      stat('Planned cash gap',money(chosen.report.cash.peakCashGapUsd),'Day '+chosen.report.cash.peakCashGapDay)+
      stat('Program schedule',chosen.scenario.project_end_day+' days','Final submission')+
      stat('Work packages',chosen.scenario.future_costs.length,chosen.planning.contributors.length+' contributors')+'</div><details class="json-details"><summary>Retained scenario and payment / staffing inputs</summary><pre>'+esc(JSON.stringify({scenario:chosen.scenario,planning:chosen.planning},null,2))+'</pre></details></section>':'<p class="help">Select a revision to review its complete saved inputs before restoring it.</p>');
}
function render(focus = false) {
  closeOperations();
  if(!state.current) return;
  controlId=0;
  $('#plan-select').innerHTML=state.plans.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===state.current.id?' selected':'')+'>'+esc(row.name)+'</option>').join('');
  $('#sections').innerHTML=tabs.map(([id,title])=>'<button type="button" data-tab="'+id+'"'+(state.tab===id?' aria-current="page"':'')+'>'+title+'</button>').join('');
  $('.savebar').hidden=state.tab==='operations';
  if(state.tab==='operations') {
    const mounted=mountOperations({container:$('#main-panel'),api,plan:state.current,inform,mutationId});
    operationsView=mounted;
    mounted.ready.catch(error=>{if(operationsView===mounted&&mounted.root.isConnected)inform(error.message,true);});
  } else {
    $('#main-panel').innerHTML=({overview,work,milestones,staffing,payments,delivery,history}[state.tab])();
  }
  updateBar();
  if(focus) $('#main-content').focus();
}
async function loadPlan(id, acknowledge = true) {
  if(acknowledge && state.dirty && !confirm('Discard the unsaved draft and reopen a saved plan?')) return render();
  const [current,versions]=await Promise.all([api('/api/plans/'+id),api('/api/plans/'+id+'/history')]);
  state.current=current;state.draft={scenario:clone(current.scenario),planning:clone(current.planning),report:clone(current.report)};
  state.dirty=false;state.stale=false;state.history=versions.revisions;state.selectedHistory=null;
  $('#change-note').value='';render();
}
async function accept(current) {
  state.plans=(await api('/api/plans')).plans;
  await loadPlan(current.id,false);
}
function patch() {
  const s=state.draft.scenario;
  const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
  return {scenario_name:s.scenario_name,award_request_usd:s.award_request_usd,project_end_day:s.project_end_day,
    milestones:s.milestones.map(row=>pick(row,['tranche','submit_day','review_and_payment_lag_days','deliverable','measurable_proof'])),
    future_costs:s.future_costs.map(row=>pick(row,['id','tranche','start_day','end_day','estimated_hours','assumed_hourly_rate_usd','amount_usd','category','remaining_work','measurable_proof']))};
}
async function calculate() {
  const result=await api('/api/plans/'+state.current.id+'/estimate',{expectedRevision:state.current.currentRevision,scenarioPatch:patch(),planning:state.draft.planning});
  state.draft=result;state.stale=false;render();inform('Draft calculated with the original SF47 model. Save a revision to retain these inputs.');
}
async function save() {
  const note=$('#change-note').value.trim();
  if(!note) throw new Error('Enter a revision note before saving.');
  const payload={expectedRevision:state.current.currentRevision,scenarioPatch:patch(),planning:state.draft.planning,note};
  payload.requestId=await mutationId('save:'+state.current.id,payload);
  const result=await api('/api/plans/'+state.current.id+'/save',payload);
  await accept(result);inform(result.unchanged?'The saved inputs are unchanged.':'Saved revision '+result.revision+'.');
}
async function download(suffix, filename) {
  const response=await api('/api/plans/'+state.current.id+'/'+suffix,undefined,{download:true});
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  inform('Downloaded saved revision '+state.current.revision+(state.dirty?'. Your unsaved draft remains in the workspace.':'.'));
}
async function run(action) {
  if(state.busy) return;
  busy(true);
  try {await action();} catch(error) {inform(error.message,true);} finally {busy(false);}
}
async function onAction(buttonNode) {
  const action=buttonNode.dataset.action,index=Number(buttonNode.dataset.index),planning=state.draft.planning;
  if(action==='calculate') return calculate();
  if(action==='save') return save();
  if(action==='reload') return loadPlan(state.current.id);
  if(action==='export') return download('export.zip','sf47-planning-workspace.zip');
  if(action==='daily') return download('daily.csv','sf47-daily-cash-flow.csv');
  if(action==='scenario') return download('scenario.json','sf47-scenario.json');
  if(action==='import') {if(state.dirty && !confirm('Import another plan and leave this unsaved draft?')) return;$('#import-file').value='';$('#import-file').click();return;}
  if(action==='clone') {
    if(state.dirty) throw new Error('Save the current draft before copying its plan.');
    const name=prompt('Name for the copied saved plan',state.current.name+' — alternative');if(name===null) return;
    const payload={name,expectedRevision:state.current.currentRevision};payload.requestId=await mutationId('clone:'+state.current.id,payload);
    await accept(await api('/api/plans/'+state.current.id+'/clone',payload));inform('Created a separate planning alternative with the original source identity.');return;
  }
  if(action==='history-view') {state.selectedHistory=await api('/api/plans/'+state.current.id+'/revision/'+buttonNode.dataset.revision);render();return;}
  if(action==='restore') {
    if(state.dirty && !confirm('Replace this unsaved draft with the selected saved revision?')) return;
    const note=prompt('Reason for restoring this revision');if(note===null)return;if(!note.trim())throw new Error('Enter a restore note.');
    const payload={expectedRevision:state.current.currentRevision,selectedRevision:Number(buttonNode.dataset.revision),note};
    payload.requestId=await mutationId('restore:'+state.current.id,payload);
    await accept(await api('/api/plans/'+state.current.id+'/restore',payload));inform('Restored the selected inputs as revision '+state.current.revision+'.');return;
  }
  if(action==='match-total') {
    state.draft.scenario.award_request_usd=moneyString(costs().reduce((total,item)=>total+plannedCents(item),0n));
  } else if(action==='use-lag') {
    for(const row of state.draft.scenario.milestones) row.review_and_payment_lag_days=Number(buttonNode.dataset.lag);
    changed();return calculate();
  } else if(action==='add-cost') {
    const id='work-'+crypto.randomUUID().slice(0,8);
    costs().push({id,tranche:1,start_day:1,end_day:state.draft.scenario.milestones[0].submit_day,estimated_hours:'1',assumed_hourly_rate_usd:'95',amount_usd:'95.00',category:'core-development',remaining_work:'',measurable_proof:''});
    planning.pricing[id]='hours';planning.payments[id]={mode:'accrual',note:''};
  } else if(action==='remove-cost') {
    const item=costs()[index];if(!confirm('Remove '+packageName(item)+' from this planning alternative?'))return;
    costs().splice(index,1);delete planning.pricing[item.id];delete planning.payments[item.id];planning.assignments=planning.assignments.filter(row=>row.costId!==item.id);
  } else if(action==='add-person') {
    planning.contributors.push({id:'person-'+crypto.randomUUID().slice(0,8),name:'',weeklyHours:'0',note:''});
  } else if(action==='remove-person') {
    const person=planning.contributors[index];if(!confirm('Remove this contributor and their assignments?'))return;
    planning.contributors.splice(index,1);planning.assignments=planning.assignments.filter(row=>row.contributorId!==person.id);
  } else if(action==='add-assignment') {
    if(!planning.contributors.length)throw new Error('Add a contributor first.');
    planning.assignments.push({costId:costs()[0].id,contributorId:planning.contributors[0].id,hours:'1'});
  } else if(action==='remove-assignment') planning.assignments.splice(index,1);
  else if(action==='add-installment') {
    const item=costs()[index];planning.payments[item.id].installments.push({day:item.end_day,usd:'0.00'});
  } else if(action==='remove-installment') planning.payments[costs()[index].id].installments.splice(Number(buttonNode.dataset.installment),1);
  else return;
  changed();render();
}
$('#workbench').addEventListener('click',event=>{
  const tab=event.target.closest('[data-tab]');
  if(tab && !state.busy){state.tab=tab.dataset.tab;render(true);return;}
  const control=event.target.closest('[data-action]');if(control)run(()=>onAction(control));
});
$('#main-panel').addEventListener('input',event=>{
  const control=event.target.closest('[data-path]');if(!control || state.busy)return;
  const parts=JSON.parse(control.dataset.path);
  let value=control.value;if(control.dataset.kind==='integer' && value!=='')value=Number(value);
  setPath(parts,value);changed();
});
$('#main-panel').addEventListener('change',event=>{
  const control=event.target.closest('select[data-path]');if(!control || state.busy)return;
  const parts=JSON.parse(control.dataset.path);
  if(parts[0]==='planning' && parts[1]==='payments' && parts.at(-1)==='mode') {
    const cid=parts[2],payment=state.draft.planning.payments[cid];
    if(payment.mode==='completion') payment.lagDays ??= 0;
    if(payment.mode==='installments') payment.installments ??= [{day:costs().find(row=>row.id===cid).end_day,usd:costs().find(row=>row.id===cid).amount_usd}];
  }
  render();
});
$('#plan-select').addEventListener('change',event=>run(()=>loadPlan(event.target.value)));
$('#import-file').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file)return;
  run(async()=>{
    const name=prompt('Name for the imported planning scenario',file.name.replace(/\.(zip|json)$/i,''));if(name===null)return;
    let current;
    if(/\.zip$/i.test(file.name)) {
      const raw=await file.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),value=>value.toString(16).padStart(2,'0')).join('');
      const requestId=await mutationId('import-bundle',{sha,name});
      current=await api('/api/import-bundle?name='+encodeURIComponent(name),raw,{raw:true,headers:{'content-type':'application/zip','X-Request-ID':requestId}});
    } else {
      const payload={name,filename:file.name,sourceBase64:sourceBase64(await file.arrayBuffer()),note:'Imported selected source scenario'};
      payload.requestId=await mutationId('import-scenario',payload);
      current=await api('/api/import-scenario',payload);
    }
    state.tab='overview';await accept(current);inform('Imported '+current.name+' with '+current.revision+' retained revision'+(current.revision===1?'':'s')+'.');
  });
});
async function openAccess(token) {
  state.token=token;
  await api('/api/access');
  sessionStorage.setItem('sf47.access',token);
  state.plans=(await api('/api/plans')).plans;
  $('#access-panel').hidden=true;$('#workbench').hidden=false;$('#sign-out').hidden=false;
  await loadPlan(state.plans[0].id,false);
  $('#access-key').value='';inform('');
}
$('#access-form').addEventListener('submit',event=>{event.preventDefault();run(()=>openAccess($('#access-key').value.trim()));});
$('#sign-out').addEventListener('click',()=>{
  if(state.dirty && !confirm('Close access and discard this unsaved draft?'))return;
  closeOperations();
  state.token=null;state.current=null;state.draft=null;state.plans=[];state.history=[];state.selectedHistory=null;state.dirty=false;
  sessionStorage.removeItem('sf47.access');$('#main-panel').replaceChildren();$('#plan-select').replaceChildren();$('#sections').replaceChildren();
  $('#workbench').hidden=true;$('#sign-out').hidden=true;$('#access-panel').hidden=false;$('#access-key').value='';inform('Workspace access closed. Saved revisions remain available.');
});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
const fragment=new URLSearchParams(location.hash.slice(1));
const supplied=fragment.get('access');
if(supplied) window.history.replaceState(null,'',location.pathname+location.search);
let stored;try {stored=sessionStorage.getItem('sf47.access');} catch {}
if(supplied || stored) {
  openAccess(supplied || stored).catch(error=>{state.token=null;$('#access-panel').hidden=false;inform(error.message,true);});
} else $('#access-panel').hidden=false;
