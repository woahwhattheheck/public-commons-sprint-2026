// SPDX-License-Identifier: MIT
// ShelfConductor inventory reconciliation, retailer data is *not* Qloo data.
export class InputError extends Error { constructor(code, detail) {super(detail);this.name='InputError';this.code=code;} }
export function requireText(value, key, max=120){
  if(typeof value!=='string'||!value.trim()||value.length>max) throw new InputError('INVALID_INPUT',`${key} must be non-empty text (max ${max} characters)`);
  return value.trim();
}
export function validateInventory(raw){
  if(!Array.isArray(raw)||raw.length<1||raw.length>500) throw new InputError('INVALID_INVENTORY','inventory must contain 1..500 lines');
  const seen=new Set();
  return raw.map((r,i)=>{
    if(!r||typeof r!=='object'||Array.isArray(r))throw new InputError('INVALID_INVENTORY',`invalid row ${i+1}`);
    const sku=requireText(r.sku,'sku',60),title=requireText(r.title,'title',200),author=requireText(r.author,'author',160);
    if(seen.has(sku))throw new InputError('DUPLICATE_SKU',`duplicate SKU: ${sku}`);seen.add(sku);
    const stock=Number(r.stock),priceCents=Number(r.price_cents);
    if(!Number.isSafeInteger(stock)||stock<0||stock>10000||!Number.isSafeInteger(priceCents)||priceCents<=0||priceCents>1000000) throw new InputError('INVALID_INVENTORY',`invalid stock or price for ${sku}`);
    const qlooId=r.qloo_id===null||r.qloo_id===undefined||r.qloo_id===''?null:requireText(r.qloo_id,'qloo_id',140);
    const shelfNote=r.shelf_note?requireText(r.shelf_note,'shelf_note',400):'';
    const category=r.category?requireText(r.category,'category',80):'Uncategorized';
    return {sku,title,author,stock,price_cents:priceCents,qloo_id:qlooId,shelf_note:shelfNote,category};
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
  const mode=body.mode??'demo';
  if(!['demo','live'].includes(mode))throw new InputError('INVALID_INPUT','mode must be demo or live');
  return {inventory,budget,maxBooks,seedTitles,excludeSkus:new Set(exclusions),mode};
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
  const stockCandidates=input.inventory.flatMap(book=>{
    if(book.stock<1||!book.qloo_id||book.price_cents>input.budget||excluded.has(book.sku))return [];
    const q=qlooMap.get(book.qloo_id);
    if(!q||seenIds.has(book.sku))return [];
    seenIds.add(book.sku);
    return [{...book,...q}];
  }).sort((a,b)=>a.source_rank-b.source_rank||a.sku.localeCompare(b.sku)).slice(0,100);
  // Bounded beam optimization: provider ORDER is the taste evidence; the local
  // utility and category-diversity reward are retailer-side heuristics, NOT Qloo scores.
  let states=[{picks:[],total:0,utility:0,categories:{}}];
  for(const book of stockCandidates){
    const next=[...states];
    for(const s of states){
      if(s.picks.length>=input.maxBooks||s.total+book.price_cents>input.budget)continue;
      const old=s.categories[book.category]??0;
      const rankUtility=Math.round(5000/(3+book.source_rank));
      const diversity=old===0?400:-old*150;
      next.push({picks:[...s.picks,book],total:s.total+book.price_cents,utility:s.utility+rankUtility+diversity,categories:{...s.categories,[book.category]:old+1}});
    }
    // Holding the same budget/quantity does not certify true global optimality;
    // preserve multiple category combinations through a bounded 96-state beam.
    states=next.sort(compareStates).slice(0,96);
  }
  const best=states.sort(compareStates)[0];
  return {
    provenance:{mode:synthetic?'SYNTHETIC_DEMO':'LIVE_QLOO',qloo_endpoint:synthetic?null:'GET /v2/insights',retailer_inventory:'USER_SUPPLIED',ranking:'Qloo order + local shelf-category heuristic (not an affinity score)',numeric_affinity:'only passed through when actually supplied by Qloo'},
    input:{budget_cents:input.budget,max_books:input.maxBooks,seed_titles:input.seedTitles},
    selected:best.picks.map(x=>({sku:x.sku,title:x.title,author:x.author,category:x.category,price_cents:x.price_cents,stock_available:x.stock,qloo_id:x.qloo_id,qloo_rank:x.source_rank,qloo_affinity:x.provider_affinity,shelf_note:x.shelf_note})),
    total_cents:best.total,remaining_cents:input.budget-best.total,candidate_count:stockCandidates.length,unresolved_inventory:input.inventory.filter(x=>!x.qloo_id).length,
    explanation:best.picks.length?'All selected SKUs are in the retailer inventory, in stock, and matched by exact Qloo entity ID.':'No in-stock listed SKU matched a returned Qloo book entity within the budget; do not substitute guessed stock or affinity.',
    excluded:Array.from(excluded)
  };
}
