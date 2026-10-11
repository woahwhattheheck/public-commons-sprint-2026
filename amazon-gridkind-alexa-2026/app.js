import {createRobustnessPanel} from './robustness-ui.js';
import {mountScenarioHandoff} from './scenario-handoff.js';
import {mountHouseholds} from './households.js';
import {createExactInputs} from './exact-inputs.js';
const $=id=>document.getElementById(id);
const loads=[{id:'laundry',label:'Laundry'},{id:'dishwasher',label:'Dishwasher'},{id:'ev-topup',label:'EV top-up'}];
const taskKeys=new Set(['id','label','kw','hours','earliest','deadline','quiet']);
let state=null,busy=true,analysisBusy=false,draftRevision=0,needsPlan=false,draftHouseholdId=null;
let handoff=null,households=null,robustness=null,exact=null;
const money=n=>'$'+Number(n||0).toFixed(2);
const rateForHour=h=>h>=17&&h<21?'peak':h>=21||h<7?'offpeak':'standard';
const occupied=()=>busy||analysisBusy;
const detachedDraft=()=>Boolean(draftHouseholdId&&state?.workspace?.selectedId!==draftHouseholdId);
const context=()=>({revision:state?.workspace?.revision,generation:state?.workspace?.generation,householdId:state?.workspace?.selectedId});
function number(id){
  const value=$(id).value;
  if(value.trim()===''||!Number.isFinite(Number(value)))throw Error('Complete all enabled scenario values.');
  return Number(value);
}
function readSimple(){
  const rates=Object.fromEntries(['offpeak','standard','peak'].map(k=>[k,number('rate-'+k)]));
  const tasks=loads.filter(t=>$(t.id+'-enabled').checked).map(t=>({...t,kw:number(t.id+'-kw'),hours:number(t.id+'-hours'),
    earliest:number(t.id+'-earliest'),deadline:number(t.id+'-deadline'),quiet:$(t.id+'-quiet').checked}));
  if(!tasks.length)throw Error('Choose at least one load to schedule.');
  return {prices:Array.from({length:24},(_,h)=>rates[rateForHour(h)]),maxKw:number('max-kw'),tasks};
}
function readScenario(){
  if(!$('advanced-mode').checked)return readSimple();
  return exact.read();
}
function simpleScenario(s){
  if(!s||!Array.isArray(s.prices)||s.prices.length!==24||!Array.isArray(s.tasks))return false;
  const rates={offpeak:s.prices[0],standard:s.prices[7],peak:s.prices[17]};
  return !s.prices.some((p,h)=>p!==rates[rateForHour(h)])&&
    !s.tasks.some(t=>!loads.some(x=>x.id===t.id&&x.label===t.label)||Object.keys(t).some(key=>!taskKeys.has(key)));
}
function fillScenario(scenario){
  if(!scenario)return false;
  exact.fill(scenario);
  $('advanced-mode').checked=!simpleScenario(scenario);
  if(!$('advanced-mode').checked){
    $('max-kw').value=scenario.maxKw;
    for(const [key,value]of Object.entries({offpeak:scenario.prices[0],standard:scenario.prices[7],peak:scenario.prices[17]}))$('rate-'+key).value=value;
    for(const load of loads){
      const task=scenario.tasks.find(t=>t.id===load.id);$(load.id+'-enabled').checked=Boolean(task);
      if(task){for(const key of ['kw','hours','earliest','deadline'])$(load.id+'-'+key).value=task[key];$(load.id+'-quiet').checked=task.quiet;}
    }
  }
  draftHouseholdId=state?.workspace?.selectedId??null;
  return true;
}
function updateControls(){
  const locked=occupied(),advanced=$('advanced-mode').checked,detached=detachedDraft();
  $('scenario-fields').disabled=locked;
  $('simple-scenario').className=advanced?'only-hidden':'';
  $('advanced-scenario').className=advanced?'':'only-hidden';
  exact?.refresh(locked||!advanced);
  for(const input of $('simple-scenario').querySelectorAll('input'))input.disabled=advanced;
  for(const load of loads){
    const enabled=$(load.id+'-enabled').checked;
    for(const key of ['kw','hours','earliest','deadline','quiet'])$(load.id+'-'+key).disabled=advanced||!enabled;
  }
  for(const id of ['plan','ask','save-scenario'])$(id).disabled=locked||!state||detached;
  for(const id of ['restore-example','cancel','reload-saved'])$(id).disabled=locked||!state;
  $('scenario-name').disabled=locked;
  $('approve').disabled=locked||needsPlan||detached||!state?.proposal||state.approved||state.status==='executed';
  $('execute').disabled=locked||needsPlan||detached||!state?.approved||state.status==='executed';
  let count=loads.filter(t=>$(t.id+'-enabled').checked).length,cap=Number($('max-kw').value);
  if(advanced){try{const s=readScenario();count=s.tasks?.length??0;cap=s.maxKw;}catch{count=0;cap=NaN;}}
  $('load-count').textContent=count+' flexible load'+(count===1?'':'s');
  $('circuit-summary').textContent=Number.isFinite(cap)&&cap>0?cap.toFixed(1)+' kW circuit cap':'Set circuit cap';
  $('scenario-status').textContent=locked?'Saving or updating this household…':detached?
    'Another tab opened a different household. Your draft is retained here: create a new household from it, or reopen the saved inputs.':
    needsPlan?'Unsaved input changes. Save this revision or plan it before approving a schedule.':
    state?.proposal?'The current proposal uses these saved household inputs.':'Inputs are saved. Plan this scenario to review its schedule.';
  robustness?.refresh();handoff?.refresh();households?.refresh();
}
function changed(){draftRevision++;needsPlan=true;$('error').textContent='';handoff?.invalidate();updateControls();}
function acceptState(data,fill=false){
  state=data;
  if(fill){fillScenario(data.scenario);needsPlan=false;draftRevision++;handoff?.invalidate();}
  render();
}
async function post(path,payload){
  const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,context:context()})});
  const data=await response.json();
  if(!response.ok){
    if(data.state){state=data.state;needsPlan=true;draftRevision++;render();}
    throw Error(data.error||`HTTP ${response.status}`);
  }
  return data;
}
async function run(fn){
  if(occupied())return null;
  busy=true;$('error').textContent='';updateControls();
  try{return await fn();}catch(error){$('error').textContent=error.message||'Request failed';return null;}
  finally{busy=false;updateControls();}
}
async function call(action,params={}){
  if(detachedDraft()&&action!=='cancel'){$('error').textContent='Reopen the selected household inputs, or create a new household from this retained draft.';return false;}
  if(needsPlan&&['approve','execute'].includes(action)){$('error').textContent='Plan the edited inputs before approving or executing.';return false;}
  const result=await run(async()=>{
    const previousId=state?.proposal?.id,data=await post('/api/action',{action,...params});
    acceptState(data,Boolean(data.proposal?.id&&data.proposal.id!==previousId));return true;
  });
  return result===true;
}
async function workspaceAction(action,params={}){
  return run(async()=>{
    if(detachedDraft()&&!['create','rename','preview-import'].includes(action))
      throw Error('Create a new household from the retained draft, or reopen saved inputs before changing this household.');
    // Preserve a valid edited revision before opening another retained record.
    if(needsPlan&&!detachedDraft()&&['select','restore','adopt-tariff','import'].includes(action)){
      const saved=await post('/api/workspace',{action:'save',input:readScenario(),name:$('scenario-name').value.trim()||'Draft before opening saved work'});
      acceptState(saved.state,true);
    }
    if(action==='save'||action==='create')params={...params,input:readScenario()};
    const data=await post('/api/workspace',{action,...params});
    if(data.state)acceptState(data.state,['save','create','select','restore','adopt-tariff','import'].includes(action));
    return data;
  });
}
async function reopenInputs(){
  return run(async()=>{const response=await fetch('/api/state');if(!response.ok)throw Error('Could not reopen saved inputs.');acceptState(await response.json(),true);});
}
function planRequest(){
  if(occupied()||!$('scenario-form').reportValidity())return;
  try{return call('propose',{input:readScenario(),label:$('scenario-name').value.trim()||undefined});}
  catch(error){$('error').textContent=error.message;}
}
async function askRequest(){
  if(occupied())return;
  let input=null,draftError=null;
  try{input=readScenario();}catch(error){draftError=error;}
  const ok=await call('say',{command:$('cmd').value,input});
  if(!ok&&draftError&&$('error').textContent==='Input object required')$('error').textContent=draftError.message;
}
function render(){
  const p=state?.proposal;$('output').className=p?'':'only-hidden';updateControls();if(!p)return;
  $('base').textContent=money(p.baseline.cost);$('optimal').textContent=money(p.optimized.cost);$('save').textContent=money(p.avoidedCost);
  const tasks=$('tasks');tasks.replaceChildren();
  for(const item of p.optimized.items){
    const row=document.createElement('div');row.className='row';
    const left=document.createElement('span');left.textContent=item.label;
    const right=document.createElement('strong');right.textContent=`${String(item.start).padStart(2,'0')}:00–${String(item.end).padStart(2,'0')}:00 | ${money(item.cost)}`;
    row.append(left,right);tasks.append(row);
  }
  const max=Math.max(...p.prices),bars=$('bars');bars.replaceChildren();
  for(const [h,price]of p.prices.entries()){
    const bar=document.createElement('div');bar.className='bar';bar.style.height=`${max===0?0:Math.round(price/max*100)}%`;
    bar.title=`Hour ${h}: ${money(price)} per kWh`;bars.append(bar);
  }
  $('status').textContent=`${state.status.toUpperCase()} · Plan ${p.id} · ${p.decisionTrace.search}`;
  $('receipt').textContent=state.receipt?JSON.stringify(state.receipt,null,2):'Approve this exact proposal, then run its simulated schedule.';
}
exact=createExactInputs({onChange:changed,isBusy:occupied});
$('scenario-form').oninput=event=>{if(event.target.id!=='advanced-mode')changed();};
$('advanced-mode').onchange=()=>{
  try{
    if($('advanced-mode').checked)exact.fill(readSimple());
    else{
      const value=exact.read();
      if(!simpleScenario(value))throw Error('These loads and prices use the hourly editor. Continue editing them here, or restore the example.');
      fillScenario(value);
    }
    changed();
  }catch(error){$('advanced-mode').checked=true;$('error').textContent=error.message;updateControls();}
};
$('scenario-form').onsubmit=event=>{event.preventDefault();planRequest();};
$('restore-example').onclick=()=>{$('scenario-form').reset();$('advanced-mode').checked=false;draftHouseholdId=state?.workspace?.selectedId;changed();};
$('reload-saved').onclick=reopenInputs;
$('save-scenario').onclick=()=>workspaceAction('save',{name:$('scenario-name').value.trim()||'Saved household inputs'});
$('ask').onclick=askRequest;$('plan').onclick=planRequest;
$('approve').onclick=()=>call('approve',{id:state?.proposal?.id});
$('execute').onclick=()=>call('execute',{id:state?.proposal?.id});
$('cancel').onclick=()=>call('cancel');
robustness=createRobustnessPanel({
  getContext:()=>({state,busy,needsPlan,draftRevision}),
  onBusyChange:value=>{analysisBusy=value;updateControls();},
  onWorkspace:value=>{
    if(value&&value.generation===state?.workspace?.generation&&value.selectedId===state.workspace.selectedId&&value.revision>=state.workspace.revision){state.workspace=value;households?.refresh();}
  },
  onAdopt:recordId=>workspaceAction('adopt-tariff',{recordId,alternativeIndex:0}),
});
households=mountHouseholds({getState:()=>state,isBusy:occupied,mutate:workspaceAction,
  onProblem:error=>{$('error').textContent=error?.message||'Household operation failed';}});
handoff=mountScenarioHandoff({getDraft:readScenario,getProposal:()=>needsPlan?null:state?.proposal,isBusy:occupied,
  applyDraft:async scenario=>{const cleared=await call('cancel');if(!cleared)throw Error('Could not clear the current plan.');fillScenario(scenario);changed();},
  onProblem:error=>{$('error').textContent=error?.message||'Scenario transfer failed';},
});
updateControls();
fetch('/api/state').then(response=>{if(!response.ok)throw Error('Could not open saved households. Reload this page to try again.');return response.json();})
  .then(data=>acceptState(data,true)).catch(error=>{$('error').textContent=error.message;})
  .finally(()=>{busy=false;updateControls();});
