'use strict';
const $ = k => document.getElementById(k);
let current = [];
function el(tag, value, cls) {const x = document.createElement(tag);if(value!==undefined)x.textContent=value;if(cls)x.className=cls;return x;}
function renderCards() {
 const target=$('markets'), query=$('search').value.trim().toLowerCase();target.replaceChildren();
 for(const m of current.filter(m=>(m.question+' '+m.id).toLowerCase().includes(query))) {
  const card=el('article', undefined,'market');card.append(el('small',m.id+' · '+m.status,'id'));
  card.append(el('h3',m.question));let row=el('div',undefined,'evidence');
  for(const [label,val] of [['YES PRICE',m.yes_probability_pct===null?'UNKNOWN':m.yes_probability_pct+'%'],['LIQUIDITY USD',m.liquidity_usd===null?'UNKNOWN':'$'+m.liquidity_usd],['VOLUME USD',m.volume_usd===null?'UNKNOWN':'$'+m.volume_usd]]){
    let item=el('div');item.append(el('small',label));item.append(el('strong',val));row.append(item);
  } card.append(row);target.append(card);
 }
 if(!target.childElementCount)target.append(el('p','No matching observations.'));
}
async function refresh(){
 $('status').textContent='Reading bounded market feed…';$('refresh').disabled=true;
 try {const res=await fetch('/api/feed',{cache:'no-store'});const data=await res.json();if(!res.ok)throw Error(data.error||'Feed unavailable');
  current=data.data;renderCards();$('mode').textContent=data.mode==='fixture'?'SYNTHETIC OFFLINE FIXTURE · NOT LIVE PANTA':'PANTA API SOURCE · LIVE FETCH';
  $('count').textContent=data.count_displayed+'/'+data.count_total_seen;$('time').textContent=data.observed_utc;$('digest').textContent=data.digest.slice(0,14)+'…';
  $('status').textContent=(data.errors||[]).join(' ')||'Data source fetched. Observations are evidence, not an investment recommendation.';
  const box=$('alerts');box.replaceChildren();for(const a of data.alerts){const item=el('div',undefined,'alert');item.append(el('small',a.market+' / '+a.severity.toUpperCase()));item.append(el('p',a.signal));box.append(item);}
  if(!box.childElementCount)box.append(el('p','No heuristic warnings for these observed prices.'));
 }catch(e){$('status').textContent='Feed error: '+e.message+'. No synthetic replacement was silently used.'}
 finally{$('refresh').disabled=false;}
}
$('refresh').addEventListener('click',refresh);$('search').addEventListener('input',renderCards);refresh();