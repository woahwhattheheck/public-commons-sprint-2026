const form = document.getElementById('planForm');
const display = document.getElementById('display');
const button = document.getElementById('generate');
const keyStatus = document.getElementById('keyStatus');
const el = (tag, cls, text) => {const e=document.createElement(tag);if(cls)e.className=cls;if(text !== undefined)e.textContent=String(text);return e;};
fetch('/api/health').then(r=>r.json()).then(result => {
  keyStatus.textContent = result.live_configured ? 'Qloo key present on server · live route available' :
    'Offline demo ready · live Qloo key not configured';
}).catch(()=>keyStatus.textContent='Connection status unavailable');
function render(plan){
  display.replaceChildren();
  const verified = plan.source === 'qloo-live' && plan.status === 'LIVE_QLOO_EVIDENCE';
  const mode = el('div', 'source-label', plan.source !== 'qloo-live' ? 'FICTIONAL SYNTHETIC DEMO' :
    verified ? 'LIVE QLOO EVIDENCE' : 'LIVE QLOO CHECK — NO VERIFIED CONCEPT');
  display.append(mode);
  if(!plan.proposals?.length){
    const explanations = {
      NO_ENTITY_MATCH: 'The seed did not resolve to a Qloo entity. Try a recognizable name.',
      UPSTREAM_INSIGHTS_UNAVAILABLE: 'Qloo insight lookups failed. No venue or cultural fit has been asserted.',
      NO_CULTURAL_MATCH: 'Qloo returned no compatible cultural candidates for this seed.',
      NO_CULTURAL_ANCHOR: 'No independent music, film or book signal was verified. No cross-category proposal was generated.',
      NO_VERIFIED_PLACE: 'No actual venue match was returned. A local venue was not invented.'
    };
    display.append(el('h3','','No grounded program concept'),el('p','hint',
      explanations[plan.status] ?? 'There was not enough verified Qloo evidence to make a recommendation.'));
  }
  for(const proposal of plan.proposals || []){
    const article=el('article','result');
    article.append(el('div','tiny','PROGRAM CONCEPT'),el('h3','',proposal.title),el('p','idea',proposal.idea));
    const ul=el('ul','evidence');
    for(const ev of proposal.evidence || []){
      const li=el('li');li.append(el('span','role',ev.role),el('span','entity',ev.entity));
      if(!ev.id.startsWith('fictional-demo-'))li.append(el('code','entity-id',ev.id));
      ul.append(li);
    }
    article.append(ul,el('p','caveat',proposal.caveat));display.append(article);
  }
  if(plan.panels?.some(p=>p.entities?.length)){
    display.append(el('h4','domain-heading','Signal paths'));const grid=el('div','domains');
    for(const p of plan.panels){const panel=el('section','domain');panel.append(el('h5','',p.category));
      for(const e of p.entities.slice(0,4))panel.append(el('p','',e.name));
      if(!p.entities.length)panel.append(el('p','quiet','No available results'));grid.append(panel);}
    display.append(grid);
  }
  const details=document.createElement('details'); details.className='trace';
  details.append(el('summary','','See agent evidence trace'));
  const list=el('ol');for(const step of plan.trace||[]){
    list.append(el('li','',`${step.stage}${step.category ? ' / '+step.category : ''}: ${step.result} (${step.count ?? step.candidates ?? '—'})`));
  }details.append(list);display.append(details);
  display.append(el('div','requests',`${plan.qloo_requests ?? 0} Qloo lookups for this plan (shared cache/singleflight may use fewer network requests)`));
}
form.addEventListener('submit',async event=>{
  event.preventDefault(); button.disabled=true; button.textContent='Building the bridge…';
  display.replaceChildren(el('p','hint','Comparing cultural signals…'));
  const data = Object.fromEntries(new FormData(form));
  try {const response = await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json(); if(!response.ok)throw new Error(result.error||`HTTP_${response.status}`);
    render(result);
  }catch(error){display.replaceChildren(el('h3','','Could not build the concept'),el('p','caveat',
    error.message === 'QLOO_LOCAL_BUDGET' ?
      'This server has reached its 60-second Qloo outbound-call budget. Retry after the local window resets, or explore the clearly labeled fictional demo.' :
      `${error.message}. Live Qloo mode requires an activated hackathon API key; try the clearly labeled fictional demo.`));}
  finally{button.disabled=false;button.textContent='Find cultural bridges ↗';}
});
