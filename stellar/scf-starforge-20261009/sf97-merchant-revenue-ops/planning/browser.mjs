// MIT. Explicit scenario editing over server-calculated original SF97 results.
const $ = id => document.getElementById(id);
const text = (tag,value,className) => { const node=document.createElement(tag); node.textContent=value; if(className)node.className=className; return node; };
const shown = value => value === null || value === undefined ? 'Unknown' : String(value);
const money = value => value === null || value === undefined ? 'Unknown' : '$'+value;
const pct = value => value === null || value === undefined ? 'Unknown' : value+'%';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PAGE_SIZE=20;
let current, source, scenarios=[], selected=0, routePage=0, busy=false, dirty=false;
let comparison=null, savedRecord=null, pendingSave=null, planList={total:0,plans:[]};
const sourceSelectionChanged=()=>Boolean(source&&$('source-review').value!==source.version);
function requireLoadedSource(){if(sourceSelectionChanged())throw new Error('Load the selected review before calculating or saving its scenarios.');}

function notice(message,error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);}
function controls(){
  document.querySelectorAll('button,input,select').forEach(node=>{node.disabled=busy||!current;});
  if(!current)return;
  $('load-source').disabled=busy||!$('source-review').value;
  $('calculate').disabled=busy||!source||!scenarios.length||sourceSelectionChanged();
  $('add-scenario').disabled=busy||scenarios.length>=12;
  $('copy-scenario').disabled=busy||!scenarios.length||scenarios.length>=12;
  $('remove-scenario').disabled=busy||scenarios.length<=1;
  $('previous-routes').disabled=busy||routePage===0;
  $('next-routes').disabled=busy||!source||(routePage+1)*PAGE_SIZE>=source.routes.length;
  $('save-plan').disabled=busy||!comparison||Boolean(savedRecord)||sourceSelectionChanged();
}
async function api(path,input){
  const response=await fetch(path,{method:input===undefined?'GET':'POST',
    headers:input===undefined?{}:{'content-type':'application/json','x-sf97-workspace':current.token},
    ...(input===undefined?{}:{body:JSON.stringify(input)})});
  let value;try{value=await response.json();}catch{throw new Error('The workspace response was interrupted. Retry the same save to recover its result.');}
  if(!response.ok)throw Object.assign(new Error(value.message||'The scenario operation failed.'),{code:value.code,status:response.status});
  return value;
}
async function run(task){if(busy)return;busy=true;controls();try{await task();}catch(error){notice(error.message,true);}finally{busy=false;controls();}}
function changed(){
  dirty=true;comparison=null;savedRecord=null;pendingSave=null;
  $('comparison-panel').hidden=true;$('saved-actions').hidden=true;
  $('edit-status').textContent='Assumptions changed · calculate the comparison again.';controls();
}
function baseRoute(id){return source.commercial.routes[id];}
function values(item,id){return {...baseRoute(id),...(item.routes?.[id]??{})};}
function newScenario(label){return {id:'plan-'+crypto.randomUUID(),label,routes:{}};}
function facts(pairs){
  const node=document.createElement('div');node.className='source-facts';
  for(const [label,value]of pairs){const item=document.createElement('div');item.className='source-fact';item.append(text('span',label),text('strong',shown(value)));node.append(item);}return node;
}
function table(rows,columns){
  const wrapper=document.createElement('div');wrapper.className='table-scroll';
  const grid=document.createElement('table'),head=document.createElement('thead'),headRow=document.createElement('tr'),body=document.createElement('tbody');
  for(const [label]of columns){const cell=text('th',label);cell.scope='col';headRow.append(cell);}head.append(headRow);
  for(const row of rows){const tr=document.createElement('tr');for(const [,getter]of columns){const cell=document.createElement('td'),value=getter(row);if(value instanceof Node)cell.append(value);else cell.textContent=shown(value);tr.append(cell);}body.append(tr);}
  grid.append(head,body);wrapper.append(grid);return wrapper;
}
function renderSourceChoices(){
  const previous=$('source-review').value;$('source-review').replaceChildren();
  for(const entry of current.history){const option=text('option',entry.label+' · '+new Date(entry.savedAt).toLocaleString());option.value=entry.version;$('source-review').append(option);}
  if(current.history.some(entry=>entry.version===previous))$('source-review').value=previous;
  if(!current.history.length){const option=text('option','Save a merchant pricing review to begin');option.value='';$('source-review').append(option);}
}
function renderSource(){
  const observation=source.observation,range=observation?.range;
  const period=range?range.from+' through '+range.to+' UTC':observation?.sessionId??'Saved operations capture';
  $('source-facts').replaceChildren(facts([['Saved review',source.label],['Services',source.routes.length],['Original observation',period],['Saved',new Date(source.savedAt).toLocaleString()]]));
  $('source-status').textContent='One fixed source for every scenario';
  $('source-warning').hidden=!source.sellerChanged;
  $('source-warning').textContent='The current seller configuration differs from this saved review. You can compare its assumptions; applying a plan requires a review of the current seller.';
  if(![...$('source-review').options].some(option=>option.value===source.version)){const option=text('option',source.label+' · retained review');option.value=source.version;$('source-review').append(option);}
  $('source-review').value=source.version;$('planning-editor').hidden=false;
}
function renderScenarioList(){
  $('scenario-list').replaceChildren();$('scenario-count').textContent=scenarios.length+' / 12';
  scenarios.forEach((item,index)=>{const button=text('button',item.label||'Unnamed scenario','planning-scenario');button.type='button';button.setAttribute('aria-current',String(index===selected));button.append(text('small',Object.keys(item.routes??{}).length+' edited service assumptions'));button.addEventListener('click',()=>{selected=index;routePage=0;renderScenarioList();renderEditor();controls();});$('scenario-list').append(button);});
}
function field(value,{label,kind='decimal',onchange,optional=false}={}){
  const input=document.createElement('input');input.setAttribute('aria-label',label);input.value=value??'';
  if(kind==='count'){input.type='number';input.min='0';input.max=String(Number.MAX_SAFE_INTEGER);input.step='1';input.required=true;}
  else if(kind==='text'){input.type='text';input.maxLength=240;input.required=!optional;}
  else{input.inputMode='decimal';input.placeholder=optional?'Unknown':'Required';input.required=!optional;}
  input.addEventListener('input',()=>{onchange(input.value);changed();renderScenarioList();});return input;
}
function renderRouteEditor(){
  const item=scenarios[selected],visible=source.routes.slice(routePage*PAGE_SIZE,(routePage+1)*PAGE_SIZE);
  const wrapper=table(visible,[['Service',route=>{const node=text('div',route.routeId);node.append(text('small',route.method+' '+route.path));return node;}],
    ...[['Unit quote · USD','unitPriceUsd','decimal',false],['Quote basis','priceBasis','text',false],['Paid requests / month','monthlyPaidTarget','count',false],['Cost / fulfillment · USD','perFulfilledUsd','decimal',true],['Cost / challenge · USD','perChallengeUsd','decimal',true]].map(([label,key,kind,optional])=>[label,route=>field(values(item,route.routeId)[key],{label:route.routeId+' · '+label,kind,optional,onchange:value=>{item.routes??={};item.routes[route.routeId]??={};item.routes[route.routeId][key]=kind==='count'?(value===''?null:Number(value)):optional?(value.trim()||null):value;}})])]);
  wrapper.querySelector('table').classList.add('planning-route-table');$('route-editor').replaceChildren(wrapper);
  $('route-paging').hidden=source.routes.length<=PAGE_SIZE;$('route-caption').textContent=(routePage*PAGE_SIZE+1)+'–'+Math.min((routePage+1)*PAGE_SIZE,source.routes.length)+' of '+source.routes.length+' services';
}
function renderEditor(){
  const item=scenarios[selected];if(!item)return;
  $('scenario-label').value=item.label;
  $('scenario-fixed').value=Object.hasOwn(item,'sharedMonthlyFixedUsd')?(item.sharedMonthlyFixedUsd??''):(source.commercial.sharedMonthlyFixedUsd??'');
  $('goal-contribution').value=item.goal?.monthlyContributionUsd??'';$('goal-margin').value=item.goal?.marginPct??'';
  renderRouteEditor();
}
function renderMetrics(row){
  const m=row.metrics;$('scenario-metrics').replaceChildren(facts([['Paid requests / month',m.plannedPaidRequests],['Gross',money(m.grossUsd)],['Variable costs',money(m.variableCostsUsd)],['Contribution before fixed',money(m.contributionBeforeFixedUsd)],['Shared fixed cost',money(m.sharedFixedUsd)],['Contribution after fixed',money(m.contributionAfterFixedUsd)],['Margin after fixed',pct(m.marginAfterFixedPct)]]));
  $('scenario-unknown').replaceChildren();
  if(m.unknownInputs?.length){const box=text('div','Complete these inputs to calculate the affected totals and targets:','planning-unknown'),list=document.createElement('ul');for(const item of m.unknownInputs)list.append(text('li',typeof item==='string'?item:JSON.stringify(item)));box.append(list);$('scenario-unknown').append(box);}
  $('scenario-routes').replaceChildren(table(m.routes,[['Service',r=>r.routeId],['Paid requests / month',r=>r.paidTargetMonth],['USD quote',r=>money(r.quoteUsd)],['Fulfillment cost',r=>money(r.perFulfilledUsd)],['Unit contribution',r=>money(r.unitContributionUsd)],['Unit margin',r=>pct(r.unitMarginPct)],['Break-even unit quote',r=>money(r.breakEvenUnitPriceUsd)],['Monthly contribution before fixed',r=>money(r.plannedContributionBeforeFixedUsd)]]));
  renderGoals(row);
}
function renderGoals(row){
  const goals=row.goals,requested=goals?.requested??{},hasTarget=Object.keys(requested).length>0;
  $('goal-status').replaceChildren();
  if(hasTarget)$('goal-status').append(facts([['Contribution target',money(requested.monthlyContributionUsd)],['Margin target',pct(requested.marginPct)],['Entered plan meets targets',goals.current?.targetMet===null?'Unknown':goals.current?.targetMet?'Yes':'No']]));
  const cards=document.createElement('div');cards.className='planning-goal-grid';
  for(const suggestion of goals?.suggestions??[]){
    const card=document.createElement('article');card.className='planning-goal-card';card.append(text('h4',suggestion.label));
    if(suggestion.status!=='READY'){
      card.append(text('p',suggestion.reason||'Complete the required inputs to calculate this option.','muted small'));
      if(suggestion.requiredInputs?.length)card.append(text('p',suggestion.requiredInputs.map(item=>typeof item==='string'?item:JSON.stringify(item)).join(' · '),'muted small'));
    }else{
      const dl=document.createElement('dl'),m=suggestion.metrics??{};
      const details=[['Monthly gross',money(m.grossUsd)],['Contribution after fixed',money(m.contributionAfterFixedUsd)],['Margin after fixed',pct(m.marginAfterFixedPct)]];
      if(suggestion.priceUpliftUsd!==undefined)details.unshift(['USD uplift / paid request',money(suggestion.priceUpliftUsd)]);
      if(suggestion.requiredBaskets!==undefined)details.unshift(['Required service-mix baskets',shown(suggestion.requiredBaskets)]);
      for(const [label,value]of details)dl.append(text('dt',label),text('dd',value));card.append(dl);
      if(suggestion.volumes?.length){const detail=document.createElement('details');detail.append(text('summary','Proposed service volumes'),table(suggestion.volumes,[['Service',r=>r.routeId],['Paid requests / month',r=>r.monthlyPaidTarget]]));card.append(detail);}
      const button=text('button','Use these assumptions');button.type='button';button.addEventListener('click',()=>applySuggestion(row.id,suggestion));card.append(button);
    }cards.append(card);
  }
  $('goal-suggestions').replaceChildren(cards);
}
function applySuggestion(id,suggestion){
  const index=scenarios.findIndex(item=>item.id===id);if(index<0||!suggestion.commercial)return;
  const original=scenarios[index],commercial=structuredClone(suggestion.commercial);
  const selectedRoutes=new Set(source.routes.map(route=>route.routeId));
  scenarios[index]={...original,sharedMonthlyFixedUsd:commercial.sharedMonthlyFixedUsd,
    routes:Object.fromEntries(Object.entries(commercial.routes).filter(([routeId])=>selectedRoutes.has(routeId)))};
  selected=index;routePage=0;changed();renderScenarioList();renderEditor();
  notice('Suggested assumptions copied into '+original.label+'. Calculate the comparison to review the resulting plan.');$('scenario-form').scrollIntoView({block:'nearest'});
}
function updateSavedActions(){
  const id=$('detail-scenario').value;$('saved-actions').hidden=!savedRecord;
  if(!savedRecord){$('saved-note').textContent='Save the comparison to reopen it, export it or apply a selected scenario.';return;}
  const prefix='/planning-files/'+savedRecord.planId+'/';
  $('download-plan').href=prefix+'plan.json';$('download-csv').href=prefix+'comparison.csv';$('download-terms').href=prefix+'terms-'+encodeURIComponent(id)+'.json';
  $('apply-plan').href='/#scenario-plan/'+savedRecord.planId+'/'+encodeURIComponent(id);
  $('apply-plan').hidden=Boolean(source.sellerChanged);
  $('saved-note').textContent='Saved · '+savedRecord.label+' · '+new Date(savedRecord.savedAt).toLocaleString()+'. Applying opens a new commercial draft with the current operations source.';
}
function showDetail(){const row=comparison?.review.scenarios.find(item=>item.id===$('detail-scenario').value);if(row)renderMetrics(row);updateSavedActions();controls();}
function renderComparison(){
  const rows=[comparison.review.baseline,...comparison.review.scenarios];
  $('comparison-table').replaceChildren(table(rows,[['Scenario',row=>row.label],['Paid requests / month',row=>row.metrics.plannedPaidRequests],['Gross · USD',row=>money(row.metrics.grossUsd)],['Variable cost · USD',row=>money(row.metrics.variableCostsUsd)],['Contribution before fixed · USD',row=>money(row.metrics.contributionBeforeFixedUsd)],['Fixed cost · USD',row=>money(row.metrics.sharedFixedUsd)],['Contribution after fixed · USD',row=>money(row.metrics.contributionAfterFixedUsd)],['Margin after fixed',row=>pct(row.metrics.marginAfterFixedPct)],['Change in contribution',row=>money(row.delta?.contributionAfterFixedUsd)]]));
  $('detail-scenario').replaceChildren();for(const row of comparison.review.scenarios){const option=text('option',row.label);option.value=row.id;$('detail-scenario').append(option);}
  const preferred=savedRecord?.selectedScenarioId??scenarios[selected]?.id;
  if(comparison.review.scenarios.some(row=>row.id===preferred))$('detail-scenario').value=preferred;
  $('comparison-caption').textContent=comparison.review.scenarios.length+' scenarios · '+source.label;
  $('comparison-panel').hidden=false;$('edit-status').textContent='Comparison calculated from the saved original review.';showDetail();
}
function renderSaved(){
  $('saved-count').textContent=planList.plans.length+' shown · '+planList.total+' saved';$('saved-plans').replaceChildren();
  if(!planList.plans.length){$('saved-plans').append(text('p','Saved scenario comparisons will appear here.','muted small'));return;}
  for(const item of planList.plans){const card=document.createElement('article');card.className='planning-saved-card';card.append(text('h3',item.label),text('p',item.sourceLabel+' · '+item.scenarioCount+' scenarios · '+new Date(item.savedAt).toLocaleString(),'muted small'));
    const actions=document.createElement('div');actions.className='button-row';const open=text('button','Open comparison');open.type='button';open.addEventListener('click',()=>run(()=>openSaved(item.planId)));const download=text('a','Plan JSON');download.href='/planning-files/'+item.planId+'/plan.json';const csv=text('a','Comparison CSV');csv.href='/planning-files/'+item.planId+'/comparison.csv';actions.append(open,download,csv);card.append(actions);$('saved-plans').append(card);}
}
async function refreshSaved(){planList=await api('/api/planning/state');renderSaved();}
async function openSaved(planId){
  if(dirty&&!window.confirm('Replace the unsaved scenario inputs with this saved comparison?'))return;
  const record=await api('/api/planning/load',{planId}),loadedSource=await api('/api/planning/source',{version:record.version});
  source=loadedSource;scenarios=structuredClone(record.inputs.scenarios);selected=Math.max(0,scenarios.findIndex(item=>item.id===record.selectedScenarioId));routePage=0;
  comparison={version:record.version,sourceLabel:record.sourceLabel,review:record.review};savedRecord=record;pendingSave=null;dirty=false;
  $('plan-label').value=record.label;renderSource();renderScenarioList();renderEditor();renderComparison();history.replaceState(null,'','#'+record.planId);
  notice('Saved comparison reopened with its original source and calculated values.');
}
async function loadSource(){
  if(dirty&&!window.confirm('Replace the unsaved scenarios with a new comparison from this review?'))return;
  const next=await api('/api/planning/source',{version:$('source-review').value});source=next;scenarios=[newScenario('Plan 1')];selected=0;routePage=0;
  comparison=null;savedRecord=null;pendingSave=null;dirty=false;$('comparison-panel').hidden=true;$('plan-label').value='';
  history.replaceState(null,'',location.pathname);renderSource();renderScenarioList();renderEditor();
  notice('Saved review loaded. Enter scenario assumptions and optional decision targets.');
}
$('source-form').addEventListener('submit',event=>{event.preventDefault();run(loadSource);});
$('source-review').addEventListener('change',()=>{
  $('comparison-panel').hidden=sourceSelectionChanged()||!comparison;
  $('source-status').textContent=sourceSelectionChanged()?'Load the selected review to begin its comparison':'One fixed source for every scenario';
  if(sourceSelectionChanged())notice('The review selection changed. Load it before calculating or saving scenarios.');
  controls();
});
$('scenario-form').addEventListener('submit',event=>event.preventDefault());
$('scenario-label').addEventListener('input',()=>{scenarios[selected].label=$('scenario-label').value;changed();renderScenarioList();});
$('scenario-fixed').addEventListener('input',()=>{scenarios[selected].sharedMonthlyFixedUsd=$('scenario-fixed').value.trim()||null;changed();});
for(const [id,key]of [['goal-contribution','monthlyContributionUsd'],['goal-margin','marginPct']])$(id).addEventListener('input',()=>{const row=scenarios[selected];row.goal??={};const value=$(id).value.trim();if(value)row.goal[key]=value;else delete row.goal[key];if(!Object.keys(row.goal).length)delete row.goal;changed();});
$('add-scenario').addEventListener('click',()=>{if(scenarios.length>=12)return;scenarios.push(newScenario('Plan '+(scenarios.length+1)));selected=scenarios.length-1;routePage=0;changed();renderScenarioList();renderEditor();});
$('copy-scenario').addEventListener('click',()=>{if(scenarios.length>=12)return;const row=structuredClone(scenarios[selected]);row.id='plan-'+crypto.randomUUID();row.label=(row.label+' copy').slice(0,100);scenarios.push(row);selected=scenarios.length-1;routePage=0;changed();renderScenarioList();renderEditor();});
$('remove-scenario').addEventListener('click',()=>{if(scenarios.length<=1)return;scenarios.splice(selected,1);selected=Math.min(selected,scenarios.length-1);routePage=0;changed();renderScenarioList();renderEditor();});
for(const [id,direction]of [['previous-routes',-1],['next-routes',1]])$(id).addEventListener('click',()=>{routePage+=direction;renderRouteEditor();controls();});
$('calculate').addEventListener('click',()=>run(async()=>{
  requireLoadedSource();
  if(!$('scenario-form').reportValidity())throw new Error('Complete the highlighted scenario inputs.');
  const result=await api('/api/planning/preview',{version:source.version,scenarios});comparison=result;savedRecord=null;pendingSave=null;renderComparison();
  notice('All scenarios calculated against the same saved review. Inspect target suggestions or save the comparison.');
}));
$('detail-scenario').addEventListener('change',()=>{pendingSave=null;showDetail();});
$('plan-label').addEventListener('input',()=>{pendingSave=null;savedRecord=null;dirty=true;updateSavedActions();controls();});
$('save-plan').addEventListener('click',()=>run(async()=>{
  requireLoadedSource();
  if(!comparison)throw new Error('Calculate the scenario comparison first.');const label=$('plan-label').value.trim();if(!label)throw new Error('Give the comparison a name.');
  pendingSave??={version:source.version,scenarios:structuredClone(scenarios),requestId:crypto.randomUUID(),label,
    selectedScenarioId:$('detail-scenario').value,reviewSha256:comparison.review.reviewSha256};
  const result=await api('/api/planning/save',pendingSave);savedRecord=result.record;dirty=false;pendingSave=null;updateSavedActions();
  history.replaceState(null,'','#'+result.planId);
  try{await refreshSaved();}catch{notice('Comparison saved. Its downloads and selected scenario are available; reopen this page to refresh the saved list.');return;}
  notice(result.recovered?'The earlier save completed. Its original comparison has been recovered.':'Comparison saved. Export it or use the selected scenario in the merchant pricing review.');
}));
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
run(async()=>{current=await api('/api/state');renderSourceChoices();await refreshSaved();const id=location.hash.slice(1);if(UUID.test(id))await openSaved(id);else notice(current.history.length?'Choose a saved pricing review to create a commercial comparison.':'Save a review in Merchant pricing, then return here to compare scenarios.');});
