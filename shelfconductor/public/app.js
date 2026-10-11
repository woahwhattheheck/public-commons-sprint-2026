// SPDX-License-Identifier: MIT
import {parseCatalog,moneyToCents,toCsv,COLUMNS} from './catalog.js';
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const state={inventory:[],meta:{},revision:0,pending:null,result:null,previous:null,excluded:new Set(),included:new Set(),seedSelections:[],page:0,epoch:0,controller:null,importEpoch:0,searchEpoch:0,editSku:null};
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function button(text,fn){const n=el('button',null,text);n.type='button';n.addEventListener('click',fn);return n;}
function message(text,error=false){$('#status').className=error?'error':'';$('#status').textContent=text;}
async function request(endpoint,body,signal){
  const r=await fetch(endpoint,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal});
  const data=await r.json();if(!r.ok)throw Error(data.message??data.error??`Request failed (${r.status}).`);return data;
}
function view(name){for(const s of document.querySelectorAll('.workspace'))s.hidden=s.id!==name;for(const b of document.querySelectorAll('nav button')){if(b.dataset.view===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}if(name==='handout')renderHandout();}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>view(b.dataset.view));
function exportEnabled(on){for(const id of ['openHandout','exportPlan','print','handoutCsv'])$('#'+id).disabled=!on;}
function invalidate(reason='Preferences changed. Rebuild the shelf.'){
  state.epoch++;state.searchEpoch++;state.controller?.abort();state.controller=null;$('#run').disabled=false;$('#cancel').hidden=true;
  if(state.result)state.previous=state.result;state.result=null;exportEnabled(false);
  $('#resultsTag').textContent='Needs rebuild';$('#cards').replaceChildren();$('#alternatives').replaceChildren();$('#totals').textContent='';$('#changes').textContent='';$('#coverage').replaceChildren();$('#evidence').textContent='No current recommendation.';$('#resultSummary').textContent=reason;$('#paper').replaceChildren(el('p',null,'The previous handout is out of date. Rebuild the shelf with the current catalog and preferences.'));
}
function freshness(b){return b.observed_at?`Stock observed ${new Date(b.observed_at).toLocaleString()}`:'Stock observation time not supplied';}
function counts(rows){return `${rows.length.toLocaleString()} rows · ${rows.filter(b=>b.qloo_id).length.toLocaleString()} linked · ${rows.filter(b=>b.stock>0).length.toLocaleString()} in stock`;}
function inventoryStatus(){
  $('#catalogCount').textContent=state.inventory.length.toLocaleString();$('#inventoryState').textContent=counts(state.inventory);
  $('#revision').textContent=`Revision ${state.revision}`;
  $('#catalogMeta').textContent=`${state.meta.source??'No catalog'} · imported ${state.meta.imported_at?new Date(state.meta.imported_at).toLocaleString():'not yet'} · ${state.inventory.filter(b=>!b.observed_at).length} rows have unknown stock observation times. Import time does not establish stock freshness.`;
  for(const id of ['catalogJson','catalogCsv'])$('#'+id).disabled=!state.inventory.length;
}
function activate(inventory,meta={}){
  state.inventory=inventory;state.meta={source:String(meta.source??'Imported catalog').slice(0,200),imported_at:typeof meta.imported_at==='string'&&Number.isFinite(Date.parse(meta.imported_at))?new Date(meta.imported_at).toISOString():new Date().toISOString(),store:String(meta.store??$('#store').value??'').slice(0,120)};
  state.revision++;state.excluded.clear();state.included.clear();state.page=0;state.pending=null;$('#store').value=state.meta.store;$('#importReview').hidden=true;
  invalidate('Inventory updated. Build a shelf from this snapshot.');inventoryStatus();renderInventory();renderConstraints();
}
async function loadDemo(){const ticket=++state.importEpoch;try{const data=await request('/api/demo-inventory');if(ticket!==state.importEpoch)return;const normalized=await request('/api/catalog',{inventory:data.inventory});if(ticket!==state.importEpoch)return;activate(normalized.inventory,{source:'Fictional example catalog',store:'Example bookstore'});$('#mode').value='demo';$('#seeds').value='River of Glass\nThe Clockwork Orchard';modeChanged();message('Fictional example loaded. Build a shelf or import your store catalog.');}catch(e){message(e.message,true);}}
function modeChanged(){
  const live=$('#mode').value==='live';$('#notice').textContent=live?'Live Qloo · provider key remains on the server. Use your store catalog.':'Demo · fictional books and rankings. No Qloo calls.';
  $('#resolveSeeds').disabled=!live;state.seedSelections=[];$('#seedReview').replaceChildren();invalidate('Recommendation source changed. Build a new shelf.');
}
$('#mode').addEventListener('change',modeChanged);$('#demo').addEventListener('click',loadDemo);
$('#catalogFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;const ticket=++state.importEpoch;state.pending=null;$('#importReview').hidden=true;
  try{
    if(file.size>8*1024*1024)throw Error('Catalog is larger than 8 MB. Split it into an appropriate store snapshot.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());const parsed=parseCatalog(text,file.name);
    const data=await request('/api/catalog',{inventory:parsed.inventory});if(ticket!==state.importEpoch)return;
    state.pending={inventory:data.inventory,meta:{...parsed.meta,source:parsed.meta.source??file.name}};$('#importSummary').textContent=`${counts(data.inventory)}. ${data.inventory.filter(b=>!b.qloo_id).length} rows need book-ID review. This will replace the current session catalog; nothing has changed yet.`;$('#importReview').hidden=false;message('Catalog validated. Review and activate it below.');
  }catch(err){if(ticket===state.importEpoch)message(`Import not applied: ${err.message}`,true);}
});
$('#activateCatalog').addEventListener('click',()=>{if(state.pending){activate(state.pending.inventory,state.pending.meta);message('Catalog activated. Review unresolved links, then return to the reader desk.');}});
$('#discardCatalog').addEventListener('click',()=>{state.importEpoch++;state.pending=null;$('#importReview').hidden=true;$('#catalogFile').value='';message('Import discarded. Current catalog is unchanged.');});
$('#store').addEventListener('input',()=>{state.meta.store=$('#store').value;invalidate('Snapshot label changed. Rebuild to update the handout.');});
function renderInventory(){
  const q=$('#filter').value.toLocaleLowerCase();const filter=$('#catalogFilter').value;
  const rows=state.inventory.filter(b=>(!q||[b.title,b.author,b.isbn,b.sku].join(' ').toLocaleLowerCase().includes(q))&&(filter==='all'||filter==='unlinked'&&!b.qloo_id||filter==='stock'&&b.stock>0||filter==='empty'&&b.stock===0));
  const pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.min(state.page,pages-1);const target=$('#inventoryRows');target.replaceChildren();
  for(const b of rows.slice(state.page*50,state.page*50+50)){
    const tr=el('tr');const title=el('td');title.append(el('strong',null,b.title),el('div',null,b.author),el('small',null,`SKU ${b.sku}${b.isbn?' · ISBN '+b.isbn:''}`),el('small',null,freshness(b)));
    const link=el('td');link.append(el('span',null,b.qloo_id?'Linked':'Needs review'));if(b.qloo_id)link.append(el('small',null,b.qloo_id));
    const action=el('td');const edit=button('Edit / link',()=>editRow(b.sku));edit.dataset.sku=b.sku;action.append(edit);tr.append(title,el('td',null,b.category),el('td',null,money(b.price_cents)),el('td',null,b.stock),link,action);target.append(tr);
  }
  if(!rows.length){const tr=el('tr');const td=el('td',null,state.inventory.length?'No rows match these filters.':'No catalog loaded. Import CSV/JSON or use the fictional example.');td.colSpan=6;tr.append(td);target.append(tr);}
  $('#pageInfo').textContent=`Page ${state.page+1} / ${pages} · ${rows.length.toLocaleString()} matching rows`;$('#previousPage').disabled=state.page===0;$('#nextPage').disabled=state.page>=pages-1;
}
for(const id of ['filter','catalogFilter'])$('#'+id).addEventListener('input',()=>{state.page=0;renderInventory();});
$('#previousPage').addEventListener('click',()=>{state.page--;renderInventory();});$('#nextPage').addEventListener('click',()=>{state.page++;renderInventory();});
function renderConstraints(){
  const box=$('#constraints');box.replaceChildren();
  for(const [set,label] of [[state.included,'Kept'],[state.excluded,'Excluded']])for(const sku of set){const b=state.inventory.find(x=>x.sku===sku);box.append(button(`${label}: ${b?.title??sku} ×`,()=>{set.delete(sku);invalidate();renderConstraints();}));}
  $('#clearConstraints').hidden=!state.included.size&&!state.excluded.size;
}
function constrain(sku,type){
  if(type==='exclude'){state.included.delete(sku);state.excluded.add(sku);}else if(type==='release')state.included.delete(sku);else{state.excluded.delete(sku);state.included.add(sku);}
  invalidate();renderConstraints();executePlan();
}
$('#clearConstraints').addEventListener('click',()=>{state.included.clear();state.excluded.clear();invalidate();renderConstraints();});
function bookCard(b,alternative=false){
  const card=el('article','book');card.dataset.sku=b.sku;card.append(el('div','category',b.category),el('h3',null,b.title),el('p','author',b.author),el('p','price',money(b.price_cents)),el('p','identity',`SKU ${b.sku}${b.isbn?' · ISBN '+b.isbn:''}`),el('p','small',`${b.stock_available} copies in retailer snapshot · Qloo order ${b.qloo_rank}`),el('p','small',freshness(b)));
  if(b.shelf_note)card.append(el('p','small',`Store note: ${b.shelf_note}`));
  const actions=el('div','actions');actions.append(button(b.kept?'Release kept title':alternative?'Include and replan':'Keep and replan',()=>constrain(b.sku,b.kept?'release':'keep')));if(!alternative)actions.append(button('Exclude and replan',()=>constrain(b.sku,'exclude')));card.append(actions);return card;
}
function render(result){
  state.result=result;$('#resultsTag').textContent=result.provenance.mode==='SYNTHETIC_DEMO'?'Fictional demo':'Live Qloo';$('#resultSummary').textContent=result.explanation;
  $('#cards').replaceChildren(...result.selected.map(b=>bookCard(b)));$('#alternatives').replaceChildren(...result.alternatives.map(b=>bookCard(b,true)));
  $('#totals').textContent=`${result.selected.length} books · ${money(result.total_cents)} total · ${money(result.remaining_cents)} left from ${money(result.input.budget_cents)}`;
  if(state.previous){const before=new Set(state.previous.selected.map(b=>b.sku)),after=new Set(result.selected.map(b=>b.sku));$('#changes').textContent=`Replan: ${result.selected.filter(b=>!before.has(b.sku)).length} added, ${state.previous.selected.filter(b=>!after.has(b.sku)).length} removed; ${state.included.size} kept.`;}
  const descriptions={out_of_stock:'out of stock',unlinked:'unlinked',excluded:'excluded',over_budget:'above budget',not_returned:'not in Qloo results',eligible:'eligible retailer SKUs'};
  $('#coverage').replaceChildren(el('p','small',Object.entries(result.coverage).map(([k,v])=>`${v} ${descriptions[k]}`).join(' · ')));
  $('#evidence').textContent=JSON.stringify({provenance:result.provenance,edition_policy:result.edition_policy,catalog:result.catalog,generated_at:result.generated_at},null,2);exportEnabled(result.selected.length>0);renderHandout();
}
function titles(){return $('#seeds').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}
async function executePlan(){
  if(!state.inventory.length){message('Load a store catalog first.',true);view('catalog');return;}
  invalidate('Building a shelf from current stock and reader preferences…');const ticket=state.epoch;const controller=new AbortController();state.controller=controller;
  $('#run').disabled=true;$('#cancel').hidden=false;message('Resolving favorite books and planning within current stock, budget and kept-title constraints…');
  try{
    const seedTitles=titles();if(!seedTitles.length||seedTitles.length>4)throw Error('Enter one to four favorite books, one per line.');
    const result=await request('/api/plan',{inventory:state.inventory,mode:$('#mode').value,budget_cents:moneyToCents($('#budget').value),max_books:Number($('#qty').value),seed_titles:seedTitles,seed_selections:state.seedSelections,exclude_skus:[...state.excluded],include_skus:[...state.included]},controller.signal);
    if(ticket!==state.epoch)return;result.catalog={...state.meta,revision:state.revision};render(result);message(result.selected.length?'Shelf ready. Keep, exclude or prepare the reader handout.':'No eligible selection. Review catalog coverage, book links, exclusions and budget.');
  }catch(e){if(ticket===state.epoch&&e.name!=='AbortError')message(e.message,true);}finally{if(ticket===state.epoch){$('#run').disabled=false;$('#cancel').hidden=true;state.controller=null;}}
}
$('#preferences').addEventListener('submit',e=>{e.preventDefault();executePlan();});$('#cancel').addEventListener('click',()=>{invalidate('Request cancelled. Rebuild when ready.');message('Request cancelled.');});
for(const id of ['seeds','budget','qty'])$('#'+id).addEventListener('input',()=>{if(id==='seeds'){state.seedSelections=[];$('#seedReview').replaceChildren();}invalidate();});
$('#resolveSeeds').addEventListener('click',async()=>{
  const list=titles();if(!list.length||list.length>4){message('Enter one to four titles, one per line.',true);return;}
  const ticket=++state.searchEpoch;$('#resolveSeeds').disabled=true;message('Looking up favorite-book candidates in Qloo…');
  try{
    const all=await Promise.all(list.map(title=>request('/api/search',{title})));if(ticket!==state.searchEpoch)return;$('#seedReview').replaceChildren();
    for(const result of all){const wrapper=el('label','seed-choice',result.query);const select=el('select');select.setAttribute('aria-label',`Qloo match for ${result.query}`);select.append(new Option('Automatic exact match',''));
      for(const b of result.candidates)select.append(new Option(`${b.title} · ${b.qloo_id}`,b.qloo_id));select.value=state.seedSelections.find(x=>x.title===result.query)?.qloo_id??'';
      select.addEventListener('change',()=>{state.seedSelections=state.seedSelections.filter(x=>x.title!==result.query);if(select.value)state.seedSelections.push({title:result.query,qloo_id:select.value});invalidate('Book identity selection changed. Build a new shelf.');});wrapper.append(select,el('small',null,result.candidates.length?'Choose the correct returned title; the server verifies your selection again.':'No book matches. Edit the favorite title and search again.'));$('#seedReview').append(wrapper);
    }message('Review matches, then build the shelf.');
  }catch(e){if(ticket===state.searchEpoch)message(e.message,true);}finally{$('#resolveSeeds').disabled=$('#mode').value!=='live';}
});
function editRow(sku){
  const b=state.inventory.find(x=>x.sku===sku);if(!b)return;state.editSku=sku;$('#editIdentity').textContent=`${b.title} — ${b.author} · ${b.sku}`;$('#editStock').value=b.stock;$('#editPrice').value=(b.price_cents/100).toFixed(2);$('#editObserved').value=b.observed_at??'';$('#editIsbn').value=b.isbn??'';$('#editQloo').value=b.qloo_id??'';$('#editStatus').textContent='';$('#catalogMatches').replaceChildren();$('#editor').showModal();
}
$('#closeEditor').addEventListener('click',()=>$('#editor').close());$('#clearLink').addEventListener('click',()=>{$('#editQloo').value='';});
$('#searchInventory').addEventListener('click',async()=>{
  const sku=state.editSku,b=state.inventory.find(x=>x.sku===sku);if(!b)return;$('#editStatus').textContent='Searching Qloo…';
  try{const result=await request('/api/search',{title:b.title.slice(0,120)});if(state.editSku!==sku||!$('#editor').open)return;
    const select=el('select');select.setAttribute('aria-label','Inventory Qloo matches');select.append(new Option('Choose the matching Qloo book',''));for(const c of result.candidates)select.append(new Option(`${c.title} · ${c.qloo_id}`,c.qloo_id));select.addEventListener('change',()=>{$('#editQloo').value=select.value;});$('#catalogMatches').replaceChildren(select);$('#editStatus').textContent=`${result.candidates.length} returned book entities. Review before saving.`;
  }catch(e){if(state.editSku===sku)$('#editStatus').textContent=e.message;}
});
$('#editForm').addEventListener('submit',async e=>{
  e.preventDefault();const sku=state.editSku,revision=state.revision;const old=state.inventory.find(x=>x.sku===sku);if(!old)return;
  try{const row={...old,stock:$('#editStock').value,price_cents:moneyToCents($('#editPrice').value),observed_at:$('#editObserved').value.trim(),isbn:$('#editIsbn').value.trim(),qloo_id:$('#editQloo').value.trim()};const result=await request('/api/catalog',{inventory:[row]});if(revision!==state.revision)throw Error('Catalog changed while editing. Reopen the current row.');
    state.inventory=state.inventory.map(b=>b.sku===sku?result.inventory[0]:b);state.revision++;invalidate('Stock or book identity changed. Rebuild before using the old selection.');inventoryStatus();renderInventory();$('#editor').close();message('Session adjustment saved. Your retailer system was not changed.');
  }catch(err){$('#editStatus').textContent=err.message;}
});
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const jsonFile=(name,value)=>download(name,JSON.stringify(value,null,2)+'\n','application/json');
$('#catalogJson').addEventListener('click',()=>jsonFile('shelfconductor-catalog.json',{format:'shelfconductor-catalog/v1',meta:{...state.meta,revision:state.revision},inventory:state.inventory}));
$('#catalogCsv').addEventListener('click',()=>download('shelfconductor-catalog.csv',toCsv(state.inventory),'text/csv;charset=utf-8'));
$('#template').addEventListener('click',()=>download('shelfconductor-inventory-template.csv',COLUMNS.join(',')+'\r\n','text/csv;charset=utf-8'));
$('#exportPlan').addEventListener('click',()=>{if(state.result)jsonFile('shelfconductor-plan.json',state.result);});
$('#openHandout').addEventListener('click',()=>view('handout'));$('#print').addEventListener('click',()=>{if(state.result){view('handout');window.print();}});
$('#handoutCsv').addEventListener('click',()=>{if(state.result)download('shelfconductor-selection.csv',toCsv(state.result.selected.map(b=>({...b,stock:b.stock_available})),['sku','isbn','title','author','category','price_cents','currency','stock','observed_at','qloo_id','qloo_rank','shelf_note']),'text/csv;charset=utf-8');});
function renderHandout(){
  const r=state.result;if(!r)return;const paper=$('#paper');paper.replaceChildren();paper.append(el('p','eyebrow',r.catalog.store||'Your bookstore'),el('h1',null,'Your reading shelf'),el('p',null,r.provenance.mode==='SYNTHETIC_DEMO'?'Fictional demonstration — not real stock or Qloo results.':'Selected from your bookstore’s catalog using Qloo taste recommendations.'),el('p','footnote',`Prepared ${new Date(r.generated_at).toLocaleString()} · catalog revision ${r.catalog.revision}`));
  const list=el('ol');for(const b of r.selected){const item=el('li');item.append(el('h2',null,b.title),el('p',null,b.author),el('p',null,`${money(b.price_cents)} · ${b.category}`));if(b.shelf_note)item.append(el('p',null,b.shelf_note));item.append(el('p','footnote',`SKU ${b.sku}${b.isbn?' · ISBN '+b.isbn:''} · ${b.stock_available} copies in supplied snapshot`),el('p','footnote',freshness(b)));list.append(item);}paper.append(list,el('p','paper-total',`${money(r.total_cents)} total · ${money(r.remaining_cents)} remaining from ${money(r.input.budget_cents)}`),el('p','footnote','Availability and prices are the retailer’s supplied snapshot; confirm at the store. No books are reserved. Taxes, shipping and any checkout charges are not calculated.'));
}
(async()=>{try{const health=await request('/api/health');$('#connection').textContent=health.live_key_configured?'Connected · Live Qloo configured':'Connected · Demo available';}catch{$('#connection').textContent='Server unavailable';}if(state.importEpoch===0)await loadDemo();})();
