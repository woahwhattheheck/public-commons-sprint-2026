let report=null;let filter='all';
const byId=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function alert(message){const element=byId('alert');element.hidden=!message;element.textContent=message;}
const statusTag=status=>{let cls=status==='SUCCESS'?'ok':['FAILED','DENIED','RETURNED','BLOCKED'].includes(status)?'bad':'warn';return `<span class="pill ${cls}">${safe(status)}</span>`;};
async function api(path,method='GET',body){
  const res=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const obj=await res.json().catch(()=>({error:`HTTP ${res.status}`}));
  if(!res.ok)throw new Error(obj.error||`HTTP ${res.status}`);return obj;
}
function render(){
 if(!report)return;
 byId('source').textContent=report.source;
 byId('items').textContent=report.totals.count;
 byId('batch').textContent=report.id;
 byId('amount').textContent=`${report.totals.currency} ${report.totals.itemSum}`;
 byId('balanced').textContent=report.totals.match===null?'No aggregate amount reported':report.totals.match?'Batch amount agrees':'Aggregate mismatch — review';
 byId('flags').textContent=report.items.filter(x=>x.flags.length).length;
 byId('pending').textContent=report.totals.unresolved;
 byId('digest').textContent=`Evidence SHA256: ${report.evidenceHash}`;
 byId('limitations').textContent=report.limitations.join(' ');
 const visible=report.items.filter(item=>filter==='all'||(filter==='review'?item.flags.length:!item.flags.length));
 byId('counter').textContent=`(${visible.length})`;
 byId('rows').innerHTML=visible.map(item=>{
   const state=report.cases[item.caseId]?.state||'open';
   const signals=item.signals.topSignals.filter(x=>x.reviewLift>0).map(x=>x.token).slice(0,3).join(', ');
   const risk=item.flags.length?item.flags.join(' · '):'No rule or model flags';
   const explanation=item.signals.knownTokens?`Trained review propensity ${(item.signals.reviewProbability*100).toFixed(0)}%; terms: ${signals||'no positive signals'}`:'No known training words';
   return `<tr>
     <td><strong>${safe(item.receiver)}</strong><small>${safe(item.itemId)}</small><div class="signal">${safe(item.note.slice(0,75))}</div></td>
     <td><strong>${safe(item.currency)} ${safe(item.amount)}</strong><small>${safe(item.senderItemId)}</small></td>
     <td>${statusTag(item.status)}</td>
     <td><div class="signal" title="${safe(explanation)}">${item.signals.reviewProbability>=.67?'<span class="pill warn">Review suggested</span>':'<span class="pill">Low text signal</span>'}<small style="display:block">${safe(explanation)}</small></div></td>
     <td><div class="signal">${safe(risk)}</div><span class="pill ${state==='escalated'?'bad':state==='acknowledged'?'ok':''}">${safe(state)}</span></td>
     <td><button class="reviewbtn action" data-case="${safe(item.caseId)}" data-state="escalated">Escalate</button><button class="reviewbtn" data-case="${safe(item.caseId)}" data-state="acknowledged">Acknowledge</button></td>
   </tr>`;
 }).join('');
}
async function load(){report=await api('/api/report');render();}
async function act(fn){try{alert('');await fn();await load();}catch(e){alert(e.message);}}
byId('sync').addEventListener('click',()=>act(async()=>{
  const batchId=byId('batchId').value.trim(); if(!batchId)throw new Error('Enter a sandbox batch ID');
  await api('/api/sync','POST',{batchId});
}));
byId('demo').addEventListener('click',()=>act(()=>api('/api/load-demo','POST',{})));
byId('export').addEventListener('click',()=>{
  const a=document.createElement('a');a.href='/api/export.csv';a.download='disburselens-redacted-evidence.csv';a.click();
});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  filter=button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===button));render();
}));
byId('rows').addEventListener('click',event=>{
  const target=event.target.closest('button[data-case]');if(!target||!report)return;
  const body={caseId:target.dataset.case,state:target.dataset.state,version:report.version};
  act(()=>api('/api/decision','POST',body));
});
load().catch(e=>alert(e.message));
