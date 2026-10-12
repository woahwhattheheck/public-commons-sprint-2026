// MIT. Exact conserved supplier allocations around the unchanged SF97 analyzer.
import { plain, own, canonical, digest, fault, string, choice, period, id } from './common.mjs';
import { MAX_LINES } from './inputs.mjs';
export const SCALE=1000000n;
export function decimal(value,label,{signed=false,nullable=false}={}) {
  if(nullable&&(value===null||value===undefined||value===''))return null;
  if(typeof value!=='string'||!(signed?/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/:/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/).test(value))
    throw fault('DECIMAL_INVALID',label+' must be an exact decimal string with up to six decimal places.');
  const negative=value.startsWith('-'),[a,b='']=(negative?value.slice(1):value).split('.');
  const n=BigInt(a)*SCALE+BigInt(b.padEnd(6,'0'));return negative?-n:n;
}
export function money(value){if(value===null)return null;const sign=value<0n?'-':'',n=value<0n?-value:value;
  const fraction=(n%SCALE).toString().padStart(6,'0').replace(/0+$/,'');return sign+(n/SCALE)+(fraction?'.'+fraction:'');}
const abs=x=>x<0n?-x:x;
const sum=(items,fn)=>items.reduce((n,x)=>n+fn(x),0n);
const clone=x=>structuredClone(x);
function routeSet(pricing){return new Map(pricing.routes.map(r=>[r.routeId,r]));}
export function normalizeBook(input,pricing,sources) {
  if(!plain(input))throw fault('COST_PLAN_REQUIRED','Create a cost edition from an original saved pricing review.');
  id(input.pricingVersion,'Saved pricing review');const routes=routeSet(pricing);
  const book={schema:'stellar-forge.merchant-cost-input.v1',label:string(input.label,'Cost edition name',160),
    pricingVersion:input.pricingVersion,period:period(input.period),reason:string(input.reason,'Edition reason',2000),
    periodAlignment:{confirmed:input.periodAlignment?.confirmed===true,
      reason:string(input.periodAlignment?.reason??'','Period alignment note',2000,{empty:true})},
    currencyPolicy:'NO_AUTOMATIC_FX',rounding:'CEILING_TO_MICRO_USD',
    contextSourceIds:input.contextSourceIds??[],imports:input.imports??[],lines:[],coverage:[]};
  if(book.periodAlignment.confirmed&&!book.periodAlignment.reason.trim())
    throw fault('PERIOD_REASON_REQUIRED','Explain how supplier charges and the selected original observation cover the same scope.');
  if(!Array.isArray(book.contextSourceIds)||book.contextSourceIds.length>1000||new Set(book.contextSourceIds).size!==book.contextSourceIds.length)
    throw fault('CONTEXT_SOURCES_INVALID','Select distinct retained context sources.');
  for(const sourceId of book.contextSourceIds)if(!sources.has(id(sourceId,'Context source')))throw fault('SOURCE_NOT_FOUND','A context source is unavailable.');
  if(!Array.isArray(book.imports)||book.imports.length>1000)throw fault('IMPORTS_INVALID','The import mapping history is invalid.');
  for(const item of book.imports)if(!plain(item)||!sources.has(id(item.sourceId,'Mapped source'))||!plain(item.mapping))
    throw fault('IMPORTS_INVALID','Retain the original source and explicit CSV mapping for each import.');
  if(!Array.isArray(input.lines)||input.lines.length>MAX_LINES)throw fault('LINE_LIMIT','A cost edition supports up to 10,000 charge lines.');
  const seen=new Set(),seenSourceRows=new Set();
  for(const line of input.lines){
    if(!plain(line))throw fault('CHARGE_INVALID','Every charge line must be an object.');
    const lineId=string(line.id,'Stable charge line ID',180);
    if(seen.has(lineId))throw fault('DUPLICATE_CHARGE','Each charge line needs its own stable ID; combine neither duplicate IDs nor source rows.');
    seen.add(lineId);
    const source=sources.get(id(line.sourceId,'Charge source'));
    if(!source)throw fault('SOURCE_NOT_FOUND','A charge original is unavailable.');
    if(line.sourceRow!==null&&line.sourceRow!==undefined){const sourceRowKey=canonical([source.sourceId,line.sourceRow]);
      if(seenSourceRows.has(sourceRowKey))throw fault('DUPLICATE_SOURCE_ROW','An original charge row may appear only once in a cost edition.');
      seenSourceRows.add(sourceRowKey);}
    const kind=choice(line.kind,['BILL','CREDIT_NOTE','QUOTE'],'charge kind'),sourceKind=source.metadata.kind;
    if(!(sourceKind===kind||sourceKind==='BILL'&&kind==='CREDIT_NOTE'))
      throw fault('CHARGE_SOURCE_KIND','Charge kind must match its original bill, credit note or quote source.');
    const amount=decimal(line.amount,'Charge amount',{signed:true});
    if(kind==='CREDIT_NOTE'?amount>0n:amount<0n)throw fault('CHARGE_SIGN','Credit notes use a nonpositive amount; bills and quotes use a nonnegative amount.');
    if(typeof line.currency!=='string'||!/^[A-Z]{3}$/.test(line.currency))throw fault('CURRENCY_INVALID','Use the source currency as a three-letter uppercase code.');
    const quantity=decimal(line.quantity,'Source quantity',{nullable:true}),unit=string(line.unit??'','Quantity unit',80,{empty:true});
    if(quantity!==null&&!unit.trim())throw fault('QUANTITY_UNIT_REQUIRED','Name the original quantity unit.');
    if(line.sourceRow!==null&&line.sourceRow!==undefined&&(!Number.isSafeInteger(line.sourceRow)||line.sourceRow<1||line.sourceRow>MAX_LINES))
      throw fault('SOURCE_ROW_INVALID','Original source row is a one-based retained data-row position.');
    if(!Array.isArray(line.allocations)||line.allocations.length>routes.size)throw fault('ALLOCATIONS_INVALID','Allocate each line to distinct original seller routes.');
    const allocations=[],seenRoutes=new Set();
    for(const allocation of line.allocations){
      if(!plain(allocation)||!routes.has(allocation.routeId)||seenRoutes.has(allocation.routeId))
        throw fault('ALLOCATION_ROUTE_INVALID','Each allocation must identify one distinct original saved seller route.');
      seenRoutes.add(allocation.routeId);const allocated=decimal(allocation.amount,'Allocated amount',{signed:true});
      if(amount===0n?allocated!==0n:(amount<0n?allocated>0n:allocated<0n))
        throw fault('ALLOCATION_SIGN','Each route allocation must keep the original charge sign.');
      const allocatedQuantity=decimal(allocation.quantity,'Allocated quantity',{nullable:true});
      if(allocatedQuantity!==null&&quantity===null)throw fault('ALLOCATION_QUANTITY','An allocation cannot invent source quantity units.');
      const basis=choice(allocation.basis??'EXPLICIT_AMOUNT',['EXPLICIT_AMOUNT','OPERATOR_WEIGHT','HTTP_2XX_WEIGHT'],'allocation basis');
      allocations.push({routeId:allocation.routeId,amount:money(allocated),quantity:money(allocatedQuantity),basis,
        weight:allocation.weight===undefined||allocation.weight===null?null:money(decimal(allocation.weight,'Allocation weight')),
        reason:string(allocation.reason??'','Allocation reason',1000,{empty:true})});
    }
    if(abs(sum(allocations,x=>decimal(x.amount,'Amount',{signed:true})))>abs(amount))
      throw fault('CHARGE_OVERALLOCATED','Route allocations exceed the original signed amount for '+lineId+'.');
    if(quantity!==null&&sum(allocations,x=>decimal(x.quantity,'Quantity',{nullable:true})??0n)>quantity)
      throw fault('QUANTITY_OVERALLOCATED','Allocated source units exceed the original quantity for '+lineId+'.');
    book.lines.push({id:lineId,sourceId:source.sourceId,sourceRow:line.sourceRow??null,
      reference:string(line.reference??'','Original line reference',300,{empty:true}),
      supplier:string(line.supplier,'Supplier',160),kind,currency:line.currency,amount:money(amount),
      quantity:money(quantity),unit,description:string(line.description??'','Line description',2000,{empty:true}),allocations});
  }
  if(!Array.isArray(input.coverage)||input.coverage.length!==routes.size)throw fault('COVERAGE_REQUIRED','Record a cost-coverage assessment for every route in the saved review.');
  const covered=new Set();
  for(const item of input.coverage){
    if(!plain(item)||!routes.has(item.routeId)||covered.has(item.routeId))throw fault('COVERAGE_INVALID','Coverage must name each original route exactly once.');
    covered.add(item.routeId);const state=choice(item.state,['UNKNOWN','PARTIAL','COMPLETE'],'cost coverage');
    const note=string(item.note??'','Coverage note',2000,{empty:true});
    if(state==='COMPLETE'&&!note.trim())throw fault('COVERAGE_NOTE_REQUIRED','Explain each complete cost-scope assessment.');
    book.coverage.push({routeId:item.routeId,state,note,zeroCostConfirmed:item.zeroCostConfirmed===true});
  }
  return book;
}
function distribute(total,weights) {
  const denominator=sum(weights,x=>x.units),negative=total<0n,magnitude=abs(total);
  const rows=weights.map(x=>({...x,amount:magnitude*x.units/denominator,remainder:magnitude*x.units%denominator}));
  let remainder=magnitude-sum(rows,x=>x.amount);
  const ranked=[...rows].sort((a,b)=>a.remainder===b.remainder?(a.routeId<b.routeId?-1:a.routeId>b.routeId?1:0):a.remainder>b.remainder?-1:1);
  for(const row of ranked){if(!remainder)break;row.amount++;remainder--;}
  return new Map(rows.map(x=>[x.routeId,negative?-x.amount:x.amount]));
}
export function allocateByWeights(line,weights,{basis='OPERATOR_WEIGHT',reason=''}={}) {
  if(!Array.isArray(weights)||!weights.length||weights.length>2000)throw fault('WEIGHTS_REQUIRED','Choose routes and positive exact weights.');
  choice(basis,['OPERATOR_WEIGHT','HTTP_2XX_WEIGHT'],'weight basis');string(reason,'Weight allocation reason',1000);
  const seen=new Set(),values=weights.map(w=>{
    if(!plain(w)||typeof w.routeId!=='string'||seen.has(w.routeId))throw fault('WEIGHTS_INVALID','Weight routes must be distinct.');
    seen.add(w.routeId);const units=decimal(w.weight,'Weight');if(units<=0n)throw fault('WEIGHTS_INVALID','Weights must be positive.');
    return {routeId:w.routeId,weight:money(units),units};});
  const amounts=distribute(decimal(line.amount,'Charge amount',{signed:true}),values);
  const quantity=decimal(line.quantity,'Source quantity',{nullable:true}),quantities=quantity===null?null:distribute(quantity,values);
  return values.map(x=>({routeId:x.routeId,amount:money(amounts.get(x.routeId)),
    quantity:quantities?money(quantities.get(x.routeId)):null,basis,weight:x.weight,reason}));
}
export function costReport(book,pricing,sources) {
  const groups=new Map(),routeGroups=new Map(),lines=[],issues=[];
  for(const line of book.lines){
    const basis=line.kind==='QUOTE'?'QUOTED':'BILLED',amount=decimal(line.amount,'Amount',{signed:true}),
      allocated=sum(line.allocations,x=>decimal(x.amount,'Allocated amount',{signed:true})),unassigned=amount-allocated,
      quantity=decimal(line.quantity,'Quantity',{nullable:true}),allocatedQuantity=sum(line.allocations,x=>decimal(x.quantity,'Quantity',{nullable:true})??0n),
      key=canonical([basis,line.currency]);
    const group=groups.get(key)??{basis,currency:line.currency,amount:0n,allocated:0n,unassigned:0n,lines:0};
    group.amount+=amount;group.allocated+=allocated;group.unassigned+=unassigned;group.lines++;groups.set(key,group);
    const source=sources.get(line.sourceId),periodMatches=source.metadata.period!==null&&canonical(source.metadata.period)===canonical(book.period);
    if(!periodMatches)issues.push({code:'SOURCE_PERIOD_UNCONFIRMED',lineId:line.id,sourceId:line.sourceId,
      message:'The original source period is missing or differs from this cost edition.'});
    if(unassigned!==0n)issues.push({code:'UNASSIGNED_COST',lineId:line.id,currency:line.currency,amount:money(unassigned)});
    for(const allocation of line.allocations){
      const key=canonical([allocation.routeId,basis,line.currency]),entry=routeGroups.get(key)??{
        routeId:allocation.routeId,basis,currency:line.currency,amount:0n,lines:[],units:new Map(),periodMatches:true};
      entry.amount+=decimal(allocation.amount,'Amount',{signed:true});entry.lines.push(line.id);entry.periodMatches&&=periodMatches;
      if(allocation.quantity!==null)entry.units.set(line.unit,(entry.units.get(line.unit)??0n)+decimal(allocation.quantity,'Quantity'));
      routeGroups.set(key,entry);
    }
    lines.push({...line,basis,allocated:money(allocated),unassigned:money(unassigned),
      allocatedQuantity:quantity===null?null:money(allocatedQuantity),
      unassignedQuantity:quantity===null?null:money(quantity-allocatedQuantity),periodMatches,sourceSha256:source.sha256});
  }
  const serializedGroups=[...groups.values()].map(g=>({...g,amount:money(g.amount),allocated:money(g.allocated),unassigned:money(g.unassigned)}));
  const routes=pricing.routes.map(route=>{
    const coverage=book.coverage.find(x=>x.routeId===route.routeId),costs=[...routeGroups.values()].filter(x=>x.routeId===route.routeId);
    const success=BigInt(route.actual2xx),proposals={};
    for(const basis of ['BILLED','QUOTED']){
      const blockers=[],selected=costs.filter(x=>x.basis===basis),usd=selected.find(x=>x.currency==='USD');
      const net=usd?.amount??0n;
      if(coverage.state!=='COMPLETE')blockers.push('COST_COVERAGE_'+coverage.state);
      if(!book.periodAlignment.confirmed)blockers.push('PERIOD_ALIGNMENT_UNCONFIRMED');
      if(!success)blockers.push('NO_ORIGINAL_HTTP_2XX_DENOMINATOR');
      if(pricing.observerErrors>0)blockers.push('ORIGINAL_OBSERVER_ERRORS');
      if(pricing.usageHistory?.range?.truncatedByRetention||pricing.usageHistory?.storage?.healthy===false||pricing.usageHistory?.sessions?.some(x=>x.state==='INTERRUPTED'))
        blockers.push('ORIGINAL_HISTORY_INCOMPLETE');
      if(lines.some(x=>x.basis===basis&&decimal(x.unassigned,'Unassigned amount',{signed:true})!==0n))blockers.push('UNASSIGNED_COST_IN_SELECTED_BASIS');
      if(selected.some(x=>x.currency!=='USD'))blockers.push('NON_USD_COST_REQUIRES_SEPARATE_PRICING');
      if(selected.some(x=>!x.periodMatches))blockers.push('SOURCE_PERIOD_UNCONFIRMED');
      if(!usd&&!coverage.zeroCostConfirmed)blockers.push('NO_USD_COST_OR_CONFIRMED_ZERO');
      if(net<0n)blockers.push('NET_CREDIT_CANNOT_BE_A_NONNEGATIVE_UNIT_COST');
      const unit=blockers.length?null:(net+success-1n)/success;
      const gross=decimal(route.modeledNominal2xxValueUsd,'Original quoted 2xx value');
      proposals[basis]={basis,status:blockers.length?'NEEDS_REVIEW':'AVAILABLE',blockers,
        allocatedUsd:money(net),originalHttp2xx:route.actual2xx,perFulfilledUsd:money(unit),
        exactRatio:{numeratorMicroUsd:net.toString(),denominatorHttp2xx:route.actual2xx},
        roundedReconstructionDifferenceUsd:unit===null?null:money(unit*success-net),
        quotedHttpContributionUsd:blockers.length?null:money(gross-net),
        semantics:'Supplier cost per observed HTTP 2xx; quoted contribution is a pricing sensitivity, not recognized revenue or a cash margin.'};
    }
    return {routeId:route.routeId,method:route.method,path:route.path,actual2xx:route.actual2xx,
      originalQuoted2xxValueUsd:route.modeledNominal2xxValueUsd,existingPerFulfilledUsd:route.variablePerFulfilledUsd,
      coverage,costs:costs.map(g=>({...g,amount:money(g.amount),units:[...g.units].map(([unit,quantity])=>({unit,quantity:money(quantity)}))})),proposals};
  });
  return {schema:'stellar-forge.merchant-route-cost-report.v1',pricingVersion:book.pricingVersion,
    originalPricing:{schema:pricing.schema,generatedAt:pricing.generatedAt,sourceSha256:pricing.sourceSha256,
      observedFrom:pricing.observedFrom,observedUntil:pricing.observedUntil,originalSellerMode:pricing.originalSellerMode,
      observationKind:pricing.observationKind??'SESSION',range:pricing.usageHistory?.range??null},
    period:book.period,periodAlignment:book.periodAlignment,rounding:book.rounding,
    groups:serializedGroups,routes,lines,issues,
    sourceCount:new Set([...book.lines.map(x=>x.sourceId),...book.contextSourceIds,...book.imports.map(x=>x.sourceId)]).size,
    semantics:{money:'Bills and credits are retained cost documents, not proof of supplier payment. Quotes remain a separate sensitivity.',
      allocation:'Every amount is conserved in its own source currency; unassigned amounts remain visible. Quantity units are not converted.',
      usage:'Quota dispatches, upstream handler attempts and HTTP completions have distinct meanings. No provider charge is inferred from these counters.',
      revenue:'Native asset amounts and merchant-quoted USD retain their original meaning. No FX, recognized revenue or cash profit is inferred.',
      proposal:'Only selected nonnegative USD supplier costs enter the original per-fulfilled cost input. Original challenge/fixed costs, prices and payment options remain separately reviewed.'}};
}
export function compareCostReports(before,after) {
  const changes=[],left=new Map(before.lines.map(x=>[x.id,x])),right=new Map(after.lines.map(x=>[x.id,x]));
  for(const key of new Set([...left.keys(),...right.keys()])){
    const a=left.get(key),b=right.get(key);if(canonical(a)!==canonical(b))changes.push({id:key,
      change:!a?'ADDED':!b?'REMOVED_FROM_EDITION':'CHANGED',before:a??null,after:b??null});
  }
  return {schema:'stellar-forge.merchant-cost-comparison.v1',
    compatibility:{samePricingVersion:before.pricingVersion===after.pricingVersion,
      samePeriod:canonical(before.period)===canonical(after.period)},
    before:{period:before.period,groups:before.groups,routes:before.routes},
    after:{period:after.period,groups:after.groups,routes:after.routes},changes,
    semantics:'A removed line is absent only from the newer explicitly saved edition. Its original source and earlier allocation remain retained.'};
}
