// MIT. Portable hypothetical-input handoff for the existing GridKind product.
// This module never imports approval, execution, or a simulated device receipt.
export const GRIDKIND_SCENARIO_KIND = 'gridkind/hypothetical-scenario';
const ORDER = ['laundry', 'dishwasher', 'ev-topup'];
const LABELS = {laundry:'Laundry', dishwasher:'Dishwasher', 'ev-topup':'EV top-up'};
const BANDS = ['offpeak','standard','peak'];
const bandAt = h => h >= 17 && h < 21 ? 2 : h >= 21 || h < 7 ? 0 : 1;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = message => { throw new TypeError(message); };
function finite(x, min, max, field, integral=false) {
  if(typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max || (integral && !Number.isInteger(x)))
    fail(`Invalid ${field}. Expected a ${integral?'whole ':''}number from ${min} to ${max}.`);
  return x;
}
function keysOnly(x, keys, name) {
  if(!object(x)) fail(`${name} must be an object.`);
  for(const key of Object.keys(x)) if(!keys.includes(key)) fail(`${name} has an unsupported field: ${key}.`);
}
/** Strict original three-band UI schema, not a new optimizer or price feed. */
export function validatePortableScenario(value) {
  keysOnly(value, ['prices','maxKw','tasks'], 'Scenario');
  if(!Array.isArray(value.prices) || value.prices.length !== 24) fail('Scenario needs exactly 24 hourly prices.');
  const prices = value.prices.map((n,h)=>finite(n,0,10,`price at hour ${h}`));
  const rates = [prices[0],prices[7],prices[17]];
  for(let h=0;h<24;h++) if(prices[h] !== rates[bandAt(h)])
    fail('This editor supports three fixed tariff bands, not a custom hourly feed.');
  const maxKw = finite(value.maxKw,0.5,50,'shared circuit cap');
  if(!Array.isArray(value.tasks) || value.tasks.length<1 || value.tasks.length>3)
    fail('Choose one to three supported household loads.');
  const seen = new Set();
  const tasks = value.tasks.map(task=>{
    keysOnly(task,['id','label','kw','hours','earliest','deadline','quiet'], 'Load');
    if(!ORDER.includes(task.id) || task.label!==LABELS[task.id] || seen.has(task.id))
      fail('Unknown, duplicate, or relabeled household load.');
    seen.add(task.id);
    const kw=finite(task.kw,0.1,50,`${task.id} power`);
    const hours=finite(task.hours,1,6,`${task.id} duration`,true);
    const earliest=finite(task.earliest,0,23,`${task.id} earliest`,true);
    const deadline=finite(task.deadline,1,24,`${task.id} finish-by`,true);
    if(earliest+hours>deadline) fail(`${LABELS[task.id]} cannot finish by its deadline.`);
    if(typeof task.quiet!=='boolean') fail(`${LABELS[task.id]} quiet-hours flag must be true or false.`);
    return {id:task.id,label:task.label,kw,hours,earliest,deadline,quiet:task.quiet};
  });
  return {prices,maxKw,tasks:ORDER.filter(id=>seen.has(id)).map(id=>tasks.find(x=>x.id===id))};
}
/** Versioned, bounded transfer document. Optional summary is presentation only. */
export function makeScenarioHandoff(scenario, proposal=null, now=new Date()) {
  const safe=validatePortableScenario(scenario);
  const summary=proposal?.optimized && proposal?.baseline &&
    Number.isFinite(proposal.optimized.cost) && Number.isFinite(proposal.baseline.cost) ?
    {originalBaselineCost:proposal.baseline.cost,originalOptimizedCost:proposal.optimized.cost,
      originalPlanId:String(proposal.id || '').slice(0,60)}:null;
  return {kind:GRIDKIND_SCENARIO_KIND,version:1,exportedAt:now.toISOString(),
    scenario:safe, ...(summary ? {illustrativePlan:summary}: {})};
}
export function readScenarioHandoff(text) {
  if(typeof text!=='string' || text.length>40000) fail('Scenario file must be UTF-8 JSON, at most 40 KB.');
  let root;
  try{root=JSON.parse(text);}catch{fail('Not a valid JSON scenario document.');}
  keysOnly(root,['kind','version','exportedAt','scenario','illustrativePlan'],'Handoff document');
  if(root.kind!==GRIDKIND_SCENARIO_KIND || root.version!==1)
    fail('Not a supported GridKind hypothetical-scenario v1 file.');
  if(root.exportedAt!==undefined && (typeof root.exportedAt!=='string'||root.exportedAt.length>40))
    fail('Invalid export timestamp.');
  if(root.illustrativePlan!==undefined){
    keysOnly(root.illustrativePlan,['originalBaselineCost','originalOptimizedCost','originalPlanId'],'Illustrative summary');
    finite(root.illustrativePlan.originalBaselineCost,0,1e9,'original baseline');
    finite(root.illustrativePlan.originalOptimizedCost,0,1e9,'original optimized cost');
    if(typeof root.illustrativePlan.originalPlanId!=='string'||root.illustrativePlan.originalPlanId.length>60)
      fail('Invalid illustrative plan ID.');
  }
  // No imported proposal/approval/receipt ever reaches makeAgent(). The caller
  // applies the validated INPUTS to the editor and must invoke original offer().
  return validatePortableScenario(root.scenario);
}
export function scenarioPreview(scenario) {
  const s=validatePortableScenario(scenario);
  return `${s.tasks.length} load${s.tasks.length===1?'':'s'} (${s.tasks.map(t=>t.label).join(', ')}) · `+
    `${s.maxKw} kW circuit · off-peak $${s.prices[0].toFixed(2)}, `+
    `day $${s.prices[7].toFixed(2)}, peak $${s.prices[17].toFixed(2)} per kWh. `+
    'Imported inputs only. Any prior approval, plan ID, or receipt will NOT carry over.';
}
/** Lightweight vanilla-browser integration; callbacks reuse the ORIGINAL editor and gate. */
export function mountScenarioHandoff({getDraft, getProposal, applyDraft, onProblem, isBusy}) {
  const $=id=>document.getElementById(id);
  const input=$('handoff-file'), exportButton=$('handoff-export'), applyButton=$('handoff-apply');
  const message=$('handoff-status'), preview=$('handoff-preview');
  let pending=null, selection=0, applying=false;
  const status=text=>{message.textContent=text;};
  function invalidate(){
    if(applying)return;
    pending=null;selection++;applyButton.disabled=true;preview.textContent='';
    status('Choose a local JSON file to preview its scenario.');
  }
  exportButton.onclick=()=>{
    if(isBusy()) return;
    try{
      const file=makeScenarioHandoff(getDraft(),getProposal());
      const blob=new Blob([JSON.stringify(file,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download='gridkind-hypothetical-scenario.json';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      status('Scenario exported. It contains hypothetical inputs and an illustrative cost summary, not approval or device commands.');
    }catch(error){onProblem(error);}
  };
  input.onchange=async()=>{
    const thisSelection=++selection;
    pending=null;applyButton.disabled=true;preview.textContent='';
    const file=input.files?.[0];
    if(!file){status('No file selected.');return;}
    if(file.size>40000){status('File too large (40 KB maximum).');return;}
    status('Reading selected scenario…');
    try{
      const next=readScenarioHandoff(await file.text());
      if(thisSelection!==selection)return;
      pending=next;preview.textContent=scenarioPreview(next);
      applyButton.disabled=Boolean(isBusy());
      status('Scenario ready. Apply inputs to the editor, then plan and approve a new schedule.');
    }catch(error){if(thisSelection===selection)status(error.message||'Cannot read this scenario.');}
  };
  applyButton.onclick=()=>{
    if(!pending||isBusy())return;
    try{
      applying=true;
      // applyDraft must call the same dirty-state invalidation as manual edits.
      applyDraft(pending);
      pending=null;selection++;applyButton.disabled=true;input.value='';preview.textContent='';
      status('Inputs applied. Run Plan this scenario, then approve the newly generated schedule.');
    }catch(error){onProblem(error);}finally{applying=false;}
  };
  return {invalidate, refresh(){
    exportButton.disabled=Boolean(isBusy());
    applyButton.disabled=!pending||Boolean(isBusy());
  }};
}
