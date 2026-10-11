import {createRobustnessPanel} from './robustness-ui.js';
import {mountScenarioHandoff} from './scenario-handoff.js';
const $=id=>document.getElementById(id);
const loads=[
  {id:'laundry',label:'Laundry'},
  {id:'dishwasher',label:'Dishwasher'},
  {id:'ev-topup',label:'EV top-up'},
];
let state=null,busy=false,stateRevision=0,draftRevision=0,needsPlan=false;
let handoff=null;
const robustness=createRobustnessPanel({getContext:()=>({state,busy,needsPlan,draftRevision})});
const money=n=>'$'+Number(n||0).toFixed(2);
const rateForHour=h=>h>=17&&h<21?'peak':h>=21||h<7?'offpeak':'standard';
function number(id){
  const value=$(id).value;
  if(value.trim()===''||!Number.isFinite(Number(value)))throw Error('Complete all enabled scenario values.');
  return Number(value);
}
function readScenario(){
  const rates=Object.fromEntries(['offpeak','standard','peak'].map(k=>[k,number('rate-'+k)]));
  const tasks=loads.filter(t=>$(t.id+'-enabled').checked).map(t=>({
    ...t,kw:number(t.id+'-kw'),hours:number(t.id+'-hours'),
    earliest:number(t.id+'-earliest'),deadline:number(t.id+'-deadline'),
    quiet:$(t.id+'-quiet').checked,
  }));
  if(!tasks.length)throw Error('Choose at least one load to schedule.');
  return {prices:Array.from({length:24},(_,h)=>rates[rateForHour(h)]),maxKw:number('max-kw'),tasks};
}
function fillScenario(scenario){
  if(!scenario||!Array.isArray(scenario.prices)||scenario.prices.length!==24
      ||!Array.isArray(scenario.tasks))return false;
  const rates={offpeak:scenario.prices[0],standard:scenario.prices[7],peak:scenario.prices[17]};
  // Never pretend a custom API-only profile is represented by this band editor.
  if(scenario.prices.some((price,h)=>price!==rates[rateForHour(h)])
      ||scenario.tasks.some(t=>!loads.some(x=>x.id===t.id&&x.label===t.label)))return false;
  $('max-kw').value=scenario.maxKw;
  for(const [key,value]of Object.entries(rates))$('rate-'+key).value=value;
  for(const load of loads){
    const task=scenario.tasks.find(t=>t.id===load.id);
    $(load.id+'-enabled').checked=Boolean(task);
    if(task){
      for(const key of ['kw','hours','earliest','deadline'])$(load.id+'-'+key).value=task[key];
      $(load.id+'-quiet').checked=task.quiet;
    }
  }
  return true;
}
function updateControls(){
  $('scenario-fields').disabled=busy;
  for(const load of loads){
    const enabled=$(load.id+'-enabled').checked;
    for(const key of ['kw','hours','earliest','deadline','quiet'])$(load.id+'-'+key).disabled=!enabled;
  }
  for(const id of ['plan','ask','restore-example','cancel'])$(id).disabled=busy;
  $('approve').disabled=busy||needsPlan||!state?.proposal||state.approved||state.status==='executed';
  $('execute').disabled=busy||needsPlan||!state?.approved||state.status==='executed';
  const count=loads.filter(t=>$(t.id+'-enabled').checked).length;
  $('load-count').textContent=count+' flexible load'+(count===1?'':'s');
  const cap=Number($('max-kw').value);
  $('circuit-summary').textContent=Number.isFinite(cap)&&cap>0?cap.toFixed(1)+' kW circuit cap':'Set circuit cap';
  $('scenario-status').textContent=busy?'Planning or updating your simulation…':
    needsPlan?'Settings changed. Plan again before approving or executing.':
    state?.proposal?'This proposal uses your current scenario settings.':'Choose at least one load, then plan your scenario.';
  robustness.refresh();
  handoff?.refresh();
}
function changed(){
  draftRevision++;needsPlan=true;$('error').textContent='';handoff?.invalidate();updateControls();
}
async function call(action,params={}){
  if(busy)return;
  if(needsPlan&&['approve','execute'].includes(action)){
    $('error').textContent='Settings changed. Plan again before approving or executing.';return;
  }
  const requestedDraft=draftRevision,previousId=state?.proposal?.id;
  busy=true;$('error').textContent='';updateControls();
  try{
    const r=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...params})});
    const data=await r.json();
    if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);
    state=data;stateRevision++;
    if(data.proposal?.id&&data.proposal.id!==previousId&&requestedDraft===draftRevision)
      needsPlan=!fillScenario(data.scenario);
    render();
    return true;
  }catch(e){$('error').textContent=e.message||'Request failed';return false;}
  finally{busy=false;updateControls();}
}
function planRequest(){
  if(busy||!$('scenario-form').reportValidity())return;
  try{
    const input=readScenario();
    return call('propose',{input});
  }catch(e){$('error').textContent=e.message;}
}
async function askRequest(){
  if(busy)return;
  let input=null,draftError=null;
  try{input=readScenario();}catch(error){draftError=error;}
  // The original agent decides intent. Status and cancellation must work even
  // while the editor is incomplete; only planning consumes scenario inputs.
  const ok=await call('say',{command:$('cmd').value,input});
  if(ok===false){
    if(draftError&&$('error').textContent==='Input object required')
      $('error').textContent=draftError.message;
    $('scenario-form').reportValidity();
  }
}
function render(){
  const proposal=state?.proposal;
  $('output').className=proposal?'':'only-hidden';
  updateControls();
  if(!proposal)return;
  const p=proposal;
  $('base').textContent=money(p.baseline.cost);$('optimal').textContent=money(p.optimized.cost);$('save').textContent=money(p.avoidedCost);
  const tasks=$('tasks');tasks.replaceChildren();
  for(const item of p.optimized.items){
    const row=document.createElement('div');row.className='row';
    const left=document.createElement('span');left.textContent=item.label;
    const right=document.createElement('strong');right.textContent=`${String(item.start).padStart(2,'0')}:00–${String(item.end).padStart(2,'0')}:00 | ${money(item.cost)}`;
    row.append(left,right);tasks.append(row);
  }
  const max=Math.max(...p.prices);
  const bars=$('bars');bars.replaceChildren();
  for(const [h,price]of p.prices.entries()){
    const bar=document.createElement('div');bar.className='bar';bar.style.height=`${max===0?0:Math.round(price/max*100)}%`;
    bar.title=`Hour ${h}: ${money(price)} per kWh`;bars.append(bar);
  }
  $('status').textContent=`Status: ${state.status.toUpperCase()} · Plan ID: ${p.id} · Search: ${p.decisionTrace.search}`;
  $('receipt').textContent=state.receipt?JSON.stringify(state.receipt,null,2):'No commands issued; approval and execution are distinct actions.';
}
$('scenario-form').oninput=changed;
$('scenario-form').onsubmit=event=>{event.preventDefault();planRequest();};
$('restore-example').onclick=()=>{$('scenario-form').reset();changed();};
$('ask').onclick=askRequest;
$('plan').onclick=()=>planRequest();
$('approve').onclick=()=>call('approve',{id:state?.proposal?.id});
$('execute').onclick=()=>call('execute',{id:state?.proposal?.id});
$('cancel').onclick=()=>call('cancel');
handoff=mountScenarioHandoff({
  getDraft:readScenario,
  getProposal:()=>needsPlan?null:state?.proposal,
  isBusy:()=>busy,
  applyDraft:async scenario=>{
    // Invalidate the EXISTING server-side approval/receipt first, not just the
    // buttons. An imported file can never authorize the previously approved plan.
    const cleared=await call('cancel');
    if(!cleared)throw Error('Could not clear the previous plan. Imported assumptions were not applied.');
    if(!fillScenario(scenario))throw Error('This scenario is not supported by the editor.');
    changed(); // Fresh original offer -> human approval -> simulated dispatch.
  },
  onProblem:error=>{$('error').textContent=error?.message||'Scenario transfer failed';},
});
updateControls();
const initialRevision=stateRevision,initialDraft=draftRevision;
fetch('/api/state').then(r=>{if(!r.ok)throw Error('Could not restore current session');return r.json();}).then(data=>{
  if(stateRevision!==initialRevision)return;
  state=data;
  if(draftRevision===initialDraft)needsPlan=!fillScenario(data.scenario)&&Boolean(data.proposal);
  render();
}).catch(()=>{});


