// SPDX-License-Identifier: MIT
// ShelfConductor inventory reconciliation, retailer data is *not* Qloo data.
export class InputError extends Error { constructor(code, detail) {super(detail);this.name='InputError';this.code=code;} }
export function requireText(value, key, max=120){
  if(typeof value!=='string'||!value.trim()||value.length>max) throw new InputError('INVALID_INPUT',`${key} must be non-empty text (max ${max} characters)`);
  return value.trim();
}
export function validateInventory(raw){
  if(!Array.isArray(raw)||raw.length<1||raw.length>10000) throw new InputError('INVALID_INVENTORY','inventory must contain 1..10000 lines');
  const seen=new Set();
  return raw.map((r,i)=>{
    if(!r||typeof r!=='object'||Array.isArray(r))throw new InputError('INVALID_INVENTORY',`invalid row ${i+1}`);
    const sku=requireText(r.sku,'sku',60),title=requireText(r.title,'title',200),author=requireText(r.author,'author',160);
    if(seen.has(sku))throw new InputError('DUPLICATE_SKU',`duplicate SKU: ${sku}`);seen.add(sku);
    const integer=v=>(typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v.trim()))?Number(v):NaN;
    const stock=integer(r.stock),priceCents=integer(r.price_cents);
    if(!Number.isSafeInteger(stock)||stock<0||stock>10000||!Number.isSafeInteger(priceCents)||priceCents<=0||priceCents>1000000) throw new InputError('INVALID_INVENTORY',`invalid stock or price for ${sku}`);
    const qlooId=r.qloo_id===null||r.qloo_id===undefined||r.qloo_id===''?null:requireText(r.qloo_id,'qloo_id',140);
    const shelfNote=r.shelf_note?requireText(r.shelf_note,'shelf_note',400):'';
    const category=r.category?requireText(r.category,'category',80):'Uncategorized';
    const isbn=r.isbn?requireText(r.isbn,'isbn',32).replace(/[ -]/g,'').toUpperCase():'';
    if(isbn&&!/^(?:[0-9]{13}|[0-9]{9}[0-9X])$/.test(isbn))throw new InputError('INVALID_INVENTORY',`invalid ISBN length/characters for ${sku}`);
    if(r.currency&&r.currency!=='USD')throw new InputError('INVALID_INVENTORY',`Only USD is supported; convert the catalog explicitly before importing ${sku}`);
    let observedAt=null;
    if(r.observed_at){observedAt=requireText(r.observed_at,'observed_at',40);if(!/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(observedAt)||!Number.isFinite(Date.parse(observedAt)))throw new InputError('INVALID_INVENTORY',`observed_at needs an ISO timestamp with timezone for ${sku}`);observedAt=new Date(observedAt).toISOString();}
    return {sku,title,author,stock,price_cents:priceCents,qloo_id:qlooId,shelf_note:shelfNote,category,isbn,currency:'USD',observed_at:observedAt};
  });
}
export function validatePlan(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new InputError('INVALID_INPUT','JSON object required');
  const inventory=validateInventory(body.inventory);
  const budget=Number(body.budget_cents),maxBooks=Number(body.max_books??3);
  if(!Number.isSafeInteger(budget)||budget<100||budget>250000) throw new InputError('INVALID_INPUT','budget_cents must be 100..250000');
  if(!Number.isSafeInteger(maxBooks)||maxBooks<1||maxBooks>8) throw new InputError('INVALID_INPUT','max_books must be 1..8');
  const exclusions=body.exclude_skus??[];
  if(!Array.isArray(exclusions)||exclusions.length>500||exclusions.some(x=>typeof x!=='string'||x.length>60)) throw new InputError('INVALID_INPUT','exclude_skus invalid');
  const seeds=body.seed_titles??[];
  if(!Array.isArray(seeds)||seeds.length<1||seeds.length>4) throw new InputError('INVALID_INPUT','seed_titles must contain 1..4 books');
  const seedTitles=seeds.map((v,i)=>requireText(v,`seed_titles[${i}]`,120));
  const included=body.include_skus??[];
  if(!Array.isArray(included)||included.length>8||included.some(x=>typeof x!=='string'||!x||x.length>60))throw new InputError('INVALID_INPUT','include_skus must contain up to 8 SKUs');
  const selections=body.seed_selections??[];
  if(!Array.isArray(selections)||selections.length>4||selections.some(x=>!x||typeof x.title!=='string'||typeof x.qloo_id!=='string'||x.title.length>120||x.qloo_id.length>140))throw new InputError('INVALID_INPUT','seed_selections invalid');
  const mode=body.mode??'demo';
  if(!['demo','live'].includes(mode))throw new InputError('INVALID_INPUT','mode must be demo or live');
  if(mode==='live'&&inventory.some(x=>x.qloo_id?.startsWith('synthetic:')))throw new InputError('DEMO_INVENTORY','Load your retailer inventory before using Live Qloo.');
  return {inventory,budget,maxBooks,seedTitles,excludeSkus:new Set(exclusions),includeSkus:new Set(included),seedSelections:selections,mode};
}
function providerId(entity){
  const id=entity?.entity_id??entity?.id;
  return typeof id==='string'&&id.length>0?id:null;
}
export function normalizeInsights(payload){
  const raw=payload?.results?.entities??payload?.entities;
  if(!Array.isArray(raw))throw new InputError('UPSTREAM_SHAPE','Qloo response lacks results.entities');
  const seen=new Set();
  const out=[];
  for(const e of raw){
    const id=providerId(e);
    if(!id||seen.has(id))continue;
    seen.add(id);
    const sourceName=typeof e.name==='string'?e.name:typeof e.properties?.name==='string'?e.properties.name:null;
    // Keep provider order. Do not manufacture numerical affinity scores.
    const providerScore=Number.isFinite(e.query?.affinity)?e.query.affinity:null;
    out.push({qloo_id:id,source_name:sourceName,source_rank:out.length+1,provider_affinity:providerScore});
  }
  return out;
}
function compareStates(a,b){
  if(a.utility!==b.utility)return b.utility-a.utility;
  if(a.picks.length!==b.picks.length)return b.picks.length-a.picks.length;
  if(a.total!==b.total)return a.total-b.total;
  return a.picks.map(x=>x.sku).join('|').localeCompare(b.picks.map(x=>x.sku).join('|'));
}
export function planBooks(input,insights,{synthetic=false}={}){
  const qloo=normalizeInsights(insights);
  const qlooMap=new Map(qloo.map(x=>[x.qloo_id,x]));
  const excluded=input.excludeSkus instanceof Set?input.excludeSkus:new Set(input.excludeSkus??[]);
  const seenIds=new Set();
  const available=input.inventory.flatMap(book=>{
    if(book.stock<1||!book.qloo_id||book.price_cents>input.budget||excluded.has(book.sku))return [];
    const q=qlooMap.get(book.qloo_id);
    if(!q||seenIds.has(book.sku))return [];
    seenIds.add(book.sku);
    return [{...book,...q}];
  }).sort((a,b)=>a.source_rank-b.source_rank||a.price_cents-b.price_cents||a.sku.localeCompare(b.sku));
  const included=input.includeSkus??new Set();
  const pinned=Array.from(included).map(sku=>{const book=available.find(x=>x.sku===sku);if(!book)throw new InputError('PIN_UNAVAILABLE',`Kept SKU ${sku} is excluded, unavailable, over budget or not returned by Qloo; release it to replan`);return book;});
  if(new Set(pinned.map(x=>x.qloo_id)).size!==pinned.length)throw new InputError('PIN_CONFLICT','Keep only one edition of each Qloo book');
  const pinnedTotal=pinned.reduce((n,b)=>n+b.price_cents,0);
  if(pinned.length>input.maxBooks||pinnedTotal>input.budget)throw new InputError('PIN_BUDGET','Kept titles exceed the book count or budget; release a title or increase the limit');
  // A reader receives one edition of each title. Prefer the least expensive in-stock
  // retailer SKU for unpinned titles; manually kept editions retain their identity.
  const editions=new Map(pinned.map(b=>[b.qloo_id,b]));
  for(const b of available)if(!editions.has(b.qloo_id))editions.set(b.qloo_id,b);
  const stockCandidates=Array.from(editions.values()).sort((a,b)=>a.source_rank-b.source_rank||a.sku.localeCompare(b.sku));
  const categories={};let initialUtility=0;
  for(const b of pinned){const old=Object.hasOwn(categories,b.category)?categories[b.category]:0;Object.defineProperty(categories,b.category,{value:old+1,enumerable:true,configurable:true});initialUtility+=Math.round(5000/(3+b.source_rank))+(old===0?400:-old*150);}
  // Bounded beam optimization: provider ORDER is the taste evidence; the local
  // utility and category-diversity reward are retailer-side heuristics, NOT Qloo scores.
  let states=[{picks:pinned,total:pinnedTotal,utility:initialUtility,categories}];
  for(const book of stockCandidates){
    if(included.has(book.sku))continue;
    const next=[...states];
    for(const s of states){
      if(s.picks.length>=input.maxBooks||s.total+book.price_cents>input.budget)continue;
      const old=Object.hasOwn(s.categories,book.category)?s.categories[book.category]:0;
      const rankUtility=Math.round(5000/(3+book.source_rank));
      const diversity=old===0?400:-old*150;
      next.push({picks:[...s.picks,book],total:s.total+book.price_cents,utility:s.utility+rankUtility+diversity,categories:{...s.categories,[book.category]:old+1}});
    }
    // Holding the same budget/quantity does not certify true global optimality;
    // preserve multiple category combinations through a bounded 96-state beam.
    states=next.sort(compareStates).slice(0,96);
  }
  const best=states.sort(compareStates)[0];
  const selectedIds=new Set(best.picks.map(x=>x.qloo_id));
  const serialize=x=>({sku:x.sku,isbn:x.isbn??'',title:x.title,author:x.author,category:x.category,price_cents:x.price_cents,currency:'USD',stock_available:x.stock,observed_at:x.observed_at??null,qloo_id:x.qloo_id,qloo_rank:x.source_rank,qloo_affinity:x.provider_affinity,shelf_note:x.shelf_note,kept:included.has(x.sku)});
  const coverage={out_of_stock:0,unlinked:0,excluded:0,over_budget:0,not_returned:0,eligible:0};
  for(const b of input.inventory){const reason=b.stock<1?'out_of_stock':!b.qloo_id?'unlinked':excluded.has(b.sku)?'excluded':b.price_cents>input.budget?'over_budget':!qlooMap.has(b.qloo_id)?'not_returned':'eligible';coverage[reason]++;}
  return {
    provenance:{mode:synthetic?'SYNTHETIC_DEMO':'LIVE_QLOO',qloo_endpoint:synthetic?null:'GET /v2/insights',retailer_inventory:'USER_SUPPLIED',ranking:'Qloo order + local shelf-category heuristic (not an affinity score)',numeric_affinity:'only passed through when actually supplied by Qloo'},
    input:{budget_cents:input.budget,max_books:input.maxBooks,seed_titles:input.seedTitles},
    selected:best.picks.map(serialize),
    alternatives:stockCandidates.filter(x=>!selectedIds.has(x.qloo_id)).slice(0,12).map(serialize),coverage,
    edition_policy:'One edition per Qloo book; lowest-priced available SKU unless explicitly kept',
    total_cents:best.total,remaining_cents:input.budget-best.total,candidate_count:stockCandidates.length,unresolved_inventory:input.inventory.filter(x=>!x.qloo_id).length,
    explanation:best.picks.length?'All selected SKUs are in the retailer inventory, in stock, and matched by exact Qloo entity ID.':'No in-stock listed SKU matched a returned Qloo book entity within the budget; do not substitute guessed stock or affinity.',
    excluded:Array.from(excluded),included:Array.from(included)
  };
}
