// GridKind: view an alternative tariff through the original robustness engine.
// Selected tariffs re-enter the original household input and fresh-plan flow.
export function createRobustnessPanel({getContext,onWorkspace=()=>{},onBusyChange=()=>{},onAdopt=null}) {
  const $=id=>document.getElementById(id);
  const bands=['offpeak','standard','peak'];
  const bandForHour=h=>h>=17&&h<21?'peak':h>=21||h<7?'offpeak':'standard';
  const alternativeName='Hypothetical alternative';
  const money=value=>'$'+value.toFixed(4);
  const hour=value=>String(value).padStart(2,'0')+':00';
  let contextKey=null,inputRevision=0,pending=null,saved=null,seeded=false;
  let message='Plan the current scenario before comparing an alternative tariff.';

  function available(context) { return Boolean(context.state?.proposal?.id)&&!context.needsPlan; }
  function sameBasis(context,basis) {
    return available(context)&&context.state.proposal.id===basis.proposalId&&
      context.draftRevision===basis.draftRevision&&inputRevision===basis.inputRevision;
  }
  function clearResult(text) {
    const wasPending=Boolean(pending);
    pending?.controller.abort();pending=null;saved=null;
    $('robustness-results').className='only-hidden';
    $('robustness-export').disabled=true;
    $('robustness-error').textContent='';
    message=text;
    if(wasPending)onBusyChange(false);
  }
  function seedFromProposal(context) {
    const prices=context.state?.proposal?.prices;
    if (!Array.isArray(prices)||prices.length!==24) return false;
    const rates={offpeak:prices[0],standard:prices[7],peak:prices[17]};
    if (prices.some((price,h)=>!Number.isFinite(price)||price<0||price>10||price!==rates[bandForHour(h)]))
      return false;
    for (const band of bands) $('robustness-'+band).value=String(rates[band]);
    seeded=true;return true;
  }
  function refresh() {
    const context=getContext();
    const proposalId=context.state?.proposal?.id??'';
    const key=JSON.stringify([proposalId,context.draftRevision,context.needsPlan]);
    if (key!==contextKey) {
      const hadBasis=contextKey!==null;
      contextKey=key;
      clearResult(available(context)
        ? hadBasis?'Current proposal changed. Alternative inputs are retained; compare again.':'Change the hypothetical tariff, then compare this proposal.'
        :'Plan the current scenario before comparing an alternative tariff.');
      if (!seeded&&available(context)&&seedFromProposal(context))
        message='Alternative starts with the current proposal tariff. Change a rate, then compare.';
    }
    if (context.busy&&pending)
      clearResult('The current simulation is updating. Compare again when it finishes.');
    if (saved&&!sameBasis(context,saved)) clearResult('The comparison is no longer current. Compare again.');
    const blocked=!available(context)||context.busy;
    $('robustness-fields').disabled=blocked||Boolean(pending);
    $('robustness-compare').disabled=blocked||Boolean(pending);
    $('robustness-reset').disabled=blocked;
    $('robustness-export').disabled=blocked||Boolean(pending)||!saved;
    if($('robustness-adopt'))$('robustness-adopt').disabled=blocked||Boolean(pending)||!saved?.recordId||!onAdopt;
    $('robustness-form').setAttribute('aria-busy',String(Boolean(pending)));
    $('robustness-status').textContent=context.busy?'Current simulation is updating; tariff comparison is paused.':
      !available(context)?'Settings changed or no proposal is available. Plan the current scenario first.':message;
    $('robustness-proposal').textContent=proposalId
      ? 'Comparison basis: current proposal '+proposalId+'. Its tasks, quiet hours and circuit limit stay fixed.'
      : 'No current proposal to compare.';
  }
  function edited() {
    inputRevision++;
    clearResult('Alternative tariff changed. Compare again before exporting a report.');
    refresh();
  }
  function readPrices() {
    const rates={};
    for (const band of bands) {
      const text=$('robustness-'+band).value.trim();
      const value=Number(text);
      if (text===''||!Number.isFinite(value)||value<0||value>10)
        throw Error('Complete all three hypothetical rates with values from 0 to 10 dollars per kWh.');
      rates[band]=value;
    }
    return Array.from({length:24},(_,h)=>rates[bandForHour(h)]);
  }
  function validateReport(report,prices) {
    const row=report?.alternatives?.[0];
    if (report?.schema!=='gridkind-rate-robustness-v1'||!Array.isArray(report.alternatives)||report.alternatives.length!==1||
        !row||row.name!==alternativeName||!Array.isArray(row.ratesUsdPerKwh)||
        row.ratesUsdPerKwh.length!==24||row.ratesUsdPerKwh.some((v,i)=>v!==prices[i])||
        !Number.isFinite(report.original?.optimizedCostUsd)||
        !['retainedScheduleCostUsd','freshlyOptimizedCostUsd','regretUsd','repricingVsOriginalUsd'].every(key=>Number.isFinite(row[key]))||
        !Array.isArray(row.moves)||row.moves.some(move=>typeof move.label!=='string'||
          ![move.fromHour,move.toHour].every(h=>Number.isInteger(h)&&h>=0&&h<24)))
      throw Error('The comparison response does not match the requested tariff. Compare again.');
    return row;
  }
  function render(report,row) {
    $('robustness-original').textContent=money(report.original.optimizedCostUsd);
    $('robustness-retained').textContent=money(row.retainedScheduleCostUsd);
    $('robustness-replanned').textContent=money(row.freshlyOptimizedCostUsd);
    $('robustness-opportunity').textContent=money(row.regretUsd);
    const delta=row.repricingVsOriginalUsd;
    $('robustness-repricing').textContent=delta===0
      ? 'Keeping the current schedule has the same modeled cost under this alternative tariff.'
      : 'Keeping the current schedule costs '+money(Math.abs(delta))+' '+(delta>0?'more':'less')+
        ' under this alternative tariff than under the original tariff.';
    const body=$('robustness-moves');body.replaceChildren();
    for (const move of row.moves) {
      const tr=document.createElement('tr');
      for (const [index,value] of [move.label,hour(move.fromHour),hour(move.toHour)].entries()) {
        const cell=document.createElement(index===0?'th':'td');
        if (index===0) cell.scope='row';
        cell.textContent=value;tr.append(cell);
      }
      body.append(tr);
    }
    $('robustness-empty').textContent=row.moves.length
      ? row.moves.length+' load'+(row.moves.length===1?' would':'s would')+' move in the hypothetical replan.'
      : 'No loads move in the hypothetical replan.';
    $('robustness-empty').className='dim';
    $('robustness-results').className='';
  }
  async function compare(event) {
    event.preventDefault();
    const context=getContext();
    if (!available(context)||context.busy||pending) {refresh();return;}
    if (!$('robustness-form').reportValidity()) return;
    clearResult('Comparing this proposal under the hypothetical alternative tariff…');
    const request={proposalId:context.state.proposal.id,draftRevision:context.draftRevision,
      inputRevision,controller:new AbortController()};
    pending=request;onBusyChange(true);refresh();
    try {
      const prices=readPrices();
      const response=await fetch('/api/robustness',{method:'POST',headers:{'content-type':'application/json'},
        signal:request.controller.signal,body:JSON.stringify({proposalId:request.proposalId,
          context:context.state.workspace?{revision:context.state.workspace.revision,generation:context.state.workspace.generation,householdId:context.state.workspace.selectedId}:undefined,
          alternatives:[{name:alternativeName,prices}]})});
      const data=await response.json();
      onWorkspace(data.workspace??data.state?.workspace);
      if (pending!==request||!sameBasis(getContext(),request)||getContext().busy) return;
      if (!response.ok) throw Error(response.status===409
        ? 'This proposal is no longer current. Plan this scenario again before comparing.'
        : data.error||'Tariff comparison failed (HTTP '+response.status+').');
      if (data.proposalId!==request.proposalId) throw Error('The proposal changed. Compare the current proposal again.');
      const row=validateReport(data.report,prices);
      saved={...request,report:data.report,recordId:data.recordId};
      render(data.report,row);
      message=data.recordId?'Comparison saved in household history. Keep the current plan or use this tariff for a fresh plan.':'Comparison complete for this proposal and these alternative rates.';
    } catch (error) {
      if (pending!==request||!sameBasis(getContext(),request)) return;
      $('robustness-error').textContent=error.message||'Unable to compare tariffs.';
      message='Alternative inputs retained. Correct the issue or compare again.';
    } finally {
      if (pending===request){pending=null;onBusyChange(false);}
      refresh();
    }
  }
  $('robustness-form').addEventListener('input',edited);
  $('robustness-form').addEventListener('submit',compare);
  $('robustness-reset').addEventListener('click',()=>{
    const context=getContext();if (!available(context)||context.busy) return;
    inputRevision++;
    clearResult(seedFromProposal(context)
      ? 'Current proposal tariff copied. Change an alternative rate, then compare.'
      : 'This proposal uses a custom hourly tariff. Enter all three alternative band rates.');
    refresh();$('robustness-offpeak').focus();
  });
  $('robustness-export').addEventListener('click',()=>{
    const context=getContext();
    if (!saved||context.busy||pending||!sameBasis(context,saved)) {refresh();return;}
    const blob=new Blob([JSON.stringify(saved.report,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;
    link.download='gridkind-tariff-'+saved.proposalId.replace(/[^A-Za-z0-9_-]/g,'').slice(0,80)+'.json';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('robustness-adopt')?.addEventListener('click',()=>{
    const context=getContext();
    if(saved?.recordId&&onAdopt&&!context.busy&&!pending&&sameBasis(context,saved))onAdopt(saved.recordId);
  });
  return Object.freeze({refresh});
}
