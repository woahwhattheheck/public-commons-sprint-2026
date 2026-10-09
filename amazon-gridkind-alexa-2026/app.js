const $=id=>document.getElementById(id);
let state=null;let busy=false;
const money=n=>'$'+Number(n||0).toFixed(2);
async function call(action,params={}){
  if(busy)return;
  busy=true;$('error').textContent='';
  try{
    const r=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...params})});
    const data=await r.json();if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);state=data;render();
  }catch(e){$('error').textContent=e.message||'Request failed';}
  finally{busy=false;}
}
function render(){
  const proposal=state?.proposal;
  $('output').className=proposal?'':'only-hidden';
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
  for(const [h,price] of p.prices.entries()){
    const bar=document.createElement('div');bar.className='bar';bar.style.height=`${Math.round(price/max*100)}%`;
    bar.title=`Hour ${h}: ${money(price)} per kWh`;bars.append(bar);
  }
  $('approve').disabled=state.approved||state.status==='executed';
  $('execute').disabled=!state.approved||state.status==='executed';
  $('status').textContent=`Status: ${state.status.toUpperCase()} · Plan ID: ${p.id} · Search: ${p.decisionTrace.search}`;
  $('receipt').textContent=state.receipt?JSON.stringify(state.receipt,null,2):'No commands issued; approval and execution are distinct actions.';
}
$('ask').onclick=()=>call('say',{command:$('cmd').value});
$('plan').onclick=()=>call('propose');
$('approve').onclick=()=>call('approve',{id:state?.proposal?.id});
$('execute').onclick=()=>call('execute',{id:state?.proposal?.id});
$('cancel').onclick=()=>call('cancel');
fetch('/api/state').then(x=>x.json()).then(x=>{state=x;render()}).catch(()=>{});
