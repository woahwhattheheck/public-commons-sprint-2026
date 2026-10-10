const $=s=>document.querySelector(s);
function node(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
function render(plan){
 const root=$('#result');root.replaceChildren();
 const badge=node('div',plan.status==='RECOMMENDATIONS'?`${plan.shortlistCount} verified-fit options`:'No qualified match', 'status');root.append(badge);
 root.append(node('div',plan.providerEvidence==='LIVE_QLOO_RESPONSE'?'Live Qloo affinity evidence':'SYNTHETIC DEMONSTRATION — no live Qloo evidence','flag'));
 if(plan.operatorAuditPolicy) root.append(node('p',`Operator audit freshness policy: ${plan.operatorAuditPolicy.maxAgeDays} UTC days as of ${plan.operatorAuditPolicy.asOfUTC}. This does not independently verify venue accessibility.`,'minor'));
 if(!plan.recommended.length){root.append(node('p','The planner refused to recommend a venue because none satisfied all declared conditions AND appeared in the provider-ranked result.','empty'));}
 for(const [i,venue] of plan.recommended.entries()){
  const wrap=node('article',undefined,'rec');wrap.append(node('span',`PICK ${String(i+1).padStart(2,'0')} · Affinity rank #${venue.affinityRank}`,'rank'));
  wrap.append(node('h3',venue.name));wrap.append(node('p',`${venue.city} · ${venue.capacity} person capacity · $${venue.pricePerPersonUSD} per person`,'info'));
  wrap.append(node('p',`Access checklist: ${Object.keys(venue.accessChecklist).join(' · ').replaceAll('_',' ')}`,'minor'));
  wrap.append(node('p',`Source: ${venue.accessibilitySource}; dated ${venue.accessibilityAuditDate}. ${venue.explanation}`,'minor'));root.append(wrap);
 }
 if(plan.nearMisses.length){const details=node('details');const summary=node('summary',`${plan.nearMisses.length} venues excluded and why`);details.append(summary);const ul=node('ul');for(const v of plan.nearMisses){const li=node('li',`${v.name}: ${v.reasons.join(', ').replaceAll('_',' ')}`);ul.append(li);}details.append(ul);root.append(details);}
 const ul=node('ul',undefined,'notices');for(const s of plan.notices){ul.append(node('li',s));}root.append(ul);
}
async function init(){try{const r=await fetch('/health');const state=await r.json();$('#mode').textContent=state.mode==='live'?'LIVE QLOO · OPERATOR AUDITS':'OFFLINE DEMO · SYNTHETIC DATA';}catch{$('#mode').textContent='Status unavailable';}}
$('#planner').addEventListener('submit',async event=>{event.preventDefault();const button=$('#submit');button.disabled=true;button.firstChild.textContent='Evaluating constraints…';try{const payload={artist:$('#artist').value,groupSize:Number($('#groupSize').value),budgetUSD:Number($('#budgetUSD').value),required:[...document.querySelectorAll('input[name="required"]:checked')].map(x=>x.value)};const res=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok){$('#result').replaceChildren(node('p',`No verified recommendation: ${data.error}. Try again or check the live provider operator.`, 'empty'));return;}render(data);}catch{$('#result').replaceChildren(node('p','Planning service unavailable. No unverified suggestions were substituted.','empty'));}finally{button.disabled=false;button.firstChild.textContent='Build an accessible shortlist ';}});
init();
