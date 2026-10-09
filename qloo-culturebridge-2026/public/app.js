const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let last=null;
$('mode').addEventListener('change',()=>{$('mode-note').textContent=$('mode').value==='live'?'Live Qloo makes server-side API calls. Requires a valid QLOO_API_KEY in the server environment.':'Preview uses synthetic, clearly labeled example rankings. Select Live Qloo for actual taste intelligence (requires server key).'});
const sampleBar=r=>{const width=Math.max(9,Math.min(100,105-r*8));return `<div class="rank-bar"><b style="width:${width}%"></b></div>`};
function show(data){last=data;$('output').hidden=false;
  const preview=data.mode==='fixture';$('source-status').textContent=preview?'SYNTHETIC EXAMPLE — NOT QLOO LIVE DATA':'LIVE QLOO INSIGHTS';
  $('summary').className='summary'+(preview?' demo':'');
  $('summary').innerHTML=`${preview?'<strong>ILLUSTRATIVE PREVIEW.</strong>':'<strong>LIVE QLOO EVIDENCE.</strong>'} Found <strong>${data.counts.shared}</strong> shared ${escape(data.kind)} connections from independent searches for <strong>${escape(data.seedA)}</strong> and <strong>${escape(data.seedB)}</strong>. ${preview?'The ranking and sample records below are entirely synthetic.':'The names/ranks came from Qloo; the balance score is our own rank-based heuristic.'}`;
  $('cards').innerHTML=data.bridges.length?data.bridges.map((x,i)=>`<article class="bridge-card"><div class="card-top"><span>BRIDGE ${String(i+1).padStart(2,'0')}</span><span class="score">${x.score}<small> / 100</small></span></div><h3>${escape(x.name)}</h3><p>${escape(x.explanation)}</p><div class="rank-row"><span>${escape(data.seedA)}</span><b>#${x.rankA}</b></div><div class="rank-bar"><b style="width:${Math.max(9,105-x.rankA*8)}%"></b></div><div class="rank-row"><span>${escape(data.seedB)}</span><b>#${x.rankB}</b></div><div class="rank-bar second"><b style="width:${Math.max(9,105-x.rankB*8)}%"></b></div><div class="bridge-meta">${preview?'DEMO-ONLY ENTITY':'QLOO-SOURCED ENTITY'} · CUSTOM RANK BALANCE</div></article>`).join(''):
   '<p class="empty">No overlapping entities in the returned result sets. Try a different category or pair; an empty set is more reliable than a made-up connection.</p>';
  $('trace').innerHTML=data.trace.map(x=>`<li><b>${escape(x.step)}</b><span>${escape(x.detail)}</span></li>`).join('');
  $('method').textContent=data.method;
  $('output').scrollIntoView({behavior:'smooth',block:'start'});
}
$('bridge-form').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('submit');btn.disabled=true;btn.textContent='Connecting worlds…';
  const url=new URL('/api/bridge',location.origin);url.searchParams.set('a',$('seed-a').value);url.searchParams.set('b',$('seed-b').value);url.searchParams.set('kind',$('kind').value);url.searchParams.set('mode',$('mode').value);
  try{const res=await fetch(url);const json=await res.json();if(!res.ok)throw new Error(json.error||'Unable to connect');show(json)}catch(err){$('output').hidden=false;last=null;$('cards').innerHTML='';$('summary').className='summary demo';$('summary').textContent=err.message;$('trace').innerHTML='';$('source-status').textContent='SOURCE NOT VERIFIED';$('method').textContent='No synthetic data are silently substituted for live Qloo failures.';$('output').scrollIntoView({behavior:'smooth'})}finally{btn.disabled=false;btn.innerHTML='Find the connection <span aria-hidden="true">↗</span>'}
});
$('export').addEventListener('click',async()=>{if(!last)return;const s=`CultureBridge ${last.mode.toUpperCase()} ${last.seedA} x ${last.seedB}
${last.method}
${last.bridges.map(v=>`${v.name}: ${v.score}/100, ranks ${v.rankA}/${v.rankB}`).join('
')}
${last.warnings.join(' ')}`;try{await navigator.clipboard.writeText(s);$('export').textContent='Copied evidence brief ✓'}catch{$('export').textContent='Copy unavailable in this browser'}});
