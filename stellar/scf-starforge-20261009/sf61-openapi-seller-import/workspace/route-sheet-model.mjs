// MIT. Source-bound route selection and exact atomic prices for the original merchant plan.
export const ROUTE_SHEET_SCHEMA = 'stellar-forge.api-route-sheet.v1';
export const ROUTE_SHEET_BYTES = 4 * 1024 * 1024;
const copy=value=>structuredClone(value);
const fail=message=>{throw new TypeError(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,names,label)=>{
  if(!object(value)||Object.keys(value).some(key=>!names.includes(key)))fail('Unexpected '+label+' fields.');
};
export const routeKey=row=>String(row.method||'REF').toUpperCase()+'\u0000'+row.path;
const currency=value=>{
  fields(value,['network','asset'],'price currency');
  if(typeof value.network!=='string'||typeof value.asset!=='string')fail('Keep the original network and asset strings.');
  return {network:value.network,asset:value.asset};
};
export function atomicPrice(value,{blank=false}={}) {
  if(typeof value!=='string')fail('Atomic prices must be decimal text, including when imported from a file.');
  const amount=value.trim();
  if(blank&&amount==='')return '';
  if(!/^[0-9]{1,128}$/.test(amount)||!/[1-9]/.test(amount))fail('Enter a positive whole atomic-unit price.');
  return amount;
}
function normalizedRows(rows) {
  if(!Array.isArray(rows)||rows.length>2000)fail('Keep at most 2,000 original operations in one worksheet.');
  const seen=new Set();
  return rows.map(row=>{
    fields(row,['method','path','selected','amountAtomic'],'worksheet route');
    if(typeof row.method!=='string'||!/^[A-Z]+$/.test(row.method)||typeof row.path!=='string'||!row.path.startsWith('/')||
        typeof row.selected!=='boolean')fail('Keep each original method, path and explicit inclusion choice.');
    const key=routeKey(row);if(seen.has(key))fail('A worksheet repeats '+row.method+' '+row.path+'.');seen.add(key);
    return {method:row.method,path:row.path,selected:row.selected,amountAtomic:atomicPrice(row.amountAtomic,{blank:true})};
  });
}
export function normalizeRouteSheet(value) {
  fields(value,['schema','sourceSha256','title','currency','rows'],'route worksheet');
  if(value.schema!==ROUTE_SHEET_SCHEMA||!/^[a-f0-9]{64}$/.test(value.sourceSha256)||typeof value.title!=='string')
    fail('Open a complete source-bound API route worksheet.');
  return {schema:ROUTE_SHEET_SCHEMA,sourceSha256:value.sourceSha256,title:value.title.slice(0,240),
    currency:currency(value.currency),rows:normalizedRows(value.rows)};
}
export function routeSheetSnapshot({sourceSha256,title,operations,rows,payment}) {
  if(!Array.isArray(operations)||operations.length>2000)fail('Load the original API inventory first.');
  const current=new Map((rows||[]).map(row=>[routeKey(row),row]));
  return normalizeRouteSheet({schema:ROUTE_SHEET_SCHEMA,sourceSha256,title:title||'API merchant',
    currency:{network:payment?.network||'',asset:payment?.asset||''},
    rows:operations.map(operation=>{
      const row=current.get(routeKey(operation));
      return {method:operation.method||'REF',path:operation.path,selected:row?.selected===true,
        amountAtomic:typeof row?.amountAtomic==='string'?row.amountAtomic:''};
    })});
}
export function assertRouteSheetContext(sheet,current,operations) {
  const selected=normalizeRouteSheet(sheet),base=normalizeRouteSheet(current);
  if(selected.sourceSha256!==base.sourceSha256)fail('This worksheet belongs to another API source. Reopen that source or use the original contract revision desk to carry its settings.');
  if(selected.currency.network!==base.currency.network||selected.currency.asset!==base.currency.asset)
    fail('This worksheet uses another network or asset. Reopen its original payment terms before applying prices.');
  const available=new Map(operations.map(row=>[routeKey(row),row])),prior=new Map(base.rows.map(row=>[routeKey(row),row]));
  for(const row of selected.rows) {
    const operation=available.get(routeKey(row));
    if(!operation)fail('The source has no '+row.method+' '+row.path+'.');
    if(!operation.supported&&(row.selected||row.amountAtomic!==prior.get(routeKey(row))?.amountAtomic))
      fail(row.method+' '+row.path+' is not editable in the original seller.');
  }
  return selected;
}
export function importRouteSheet(value,current,operations) {
  const incoming=assertRouteSheetContext(value,current,operations),rows=new Map(incoming.rows.map(row=>[routeKey(row),row]));
  return {...copy(current),rows:current.rows.map(row=>copy(rows.get(routeKey(row))||row))};
}
export function routeSheetChanges(current,candidate) {
  const before=new Map(current.rows.map(row=>[routeKey(row),row])),changes=[];
  for(const row of candidate.rows) {
    const previous=before.get(routeKey(row));if(!previous)fail('Keep the original inventory when reviewing prices.');
    if(previous.selected!==row.selected||previous.amountAtomic!==row.amountAtomic)
      changes.push({method:row.method,path:row.path,before:copy(previous),after:copy(row),
        inclusionChanged:previous.selected!==row.selected,priceChanged:previous.amountAtomic!==row.amountAtomic});
  }
  return changes;
}
export function validateRouteSheet(sheet,current,operations) {
  const value=assertRouteSheetContext(sheet,current,operations);
  if(value.rows.length!==current.rows.length)fail('Review the complete inventory before applying the worksheet.');
  const included=value.rows.filter(row=>row.selected);
  if(included.length<1||included.length>64)fail('Select 1–64 routes for the original merchant compiler.');
  for(const row of included)atomicPrice(row.amountAtomic);
  return {sheet:value,selected:included.length,changes:routeSheetChanges(current,value)};
}
export function changeRoutePrices(sheet,keys,{kind,value,rounding='up'}) {
  const result=normalizeRouteSheet(sheet),targets=new Set(keys),available=new Set(result.rows.map(routeKey));
  if(!targets.size)fail('Choose at least one route for this price change.');
  for(const key of targets)if(!available.has(key))fail('Choose routes from the current worksheet.');
  if(!['fixed','percent'].includes(kind)||!['up','down','nearest'].includes(rounding))fail('Choose a fixed price or percentage change and its rounding.');
  let fixed,ratio;
  if(kind==='fixed')fixed=atomicPrice(value);
  else {
    if(typeof value!=='string'||!/^[-+]?(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,2})?$/.test(value.trim()))fail('Enter a percentage with at most two decimal places, such as 12.50 or -5.');
    const text=value.trim(),negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^[-+]/,'').split('.');
    const points=BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));
    ratio=10000n+(negative?-points:points);
    if(ratio<=0n)fail('The percentage must leave a positive price.');
  }
  result.rows=result.rows.map(row=>{
    if(!targets.has(routeKey(row)))return row;
    let amount=fixed;
    if(kind==='percent') {
      const numerator=BigInt(atomicPrice(row.amountAtomic))*ratio,denominator=10000n;
      const rounded=rounding==='up'?(numerator+denominator-1n)/denominator:
        rounding==='nearest'?(numerator+denominator/2n)/denominator:numerator/denominator;
      amount=atomicPrice(rounded.toString());
    }
    return {...row,amountAtomic:amount};
  });
  return result;
}
/** Rebase only the worksheet's two authored fields; current policy records remain elsewhere. */
export function rebaseRouteSheet(base,draft,current,operations,choices={}) {
  assertRouteSheetContext(base,current,operations);assertRouteSheetContext(draft,current,operations);
  const original=new Map(base.rows.map(row=>[routeKey(row),row]));
  const proposed=new Map(draft.rows.map(row=>[routeKey(row),row])),conflicts=[];
  const result={...copy(current),rows:current.rows.map(row=>{
    const key=routeKey(row),before=original.get(key),after=proposed.get(key),next=copy(row);
    if(!before||!after)fail('Keep the complete original worksheet base when reconciling changes.');
    for(const field of ['selected','amountAtomic']) {
      if(after[field]===before[field]||after[field]===row[field])continue;
      if(row[field]===before[field])next[field]=after[field];
      else {
        const id=key+'\u0000'+field,choice=choices[id];
        if(choice==='SHEET')next[field]=after[field];
        else if(choice!=='CURRENT')conflicts.push({id,method:row.method,path:row.path,field,
          base:before[field],current:row[field],sheet:after[field]});
      }
    }
    return next;
  })};
  return {sheet:result,conflicts};
}

/**
 * Merge worksheet selection/prices into complete native operation records.
 * New selections require their authored record in operationPlans; the caller
 * compiles the returned plan through the original authenticated preview.
 */
export function routeSheetPlan({plan,sheet,current,operations,operationPlans=[]}) {
  const review=validateRouteSheet(sheet,current,operations);
  if(!object(plan)||plan.schema!=='stellar-forge.api-merchant-plan.v1'||!Array.isArray(plan.operations)||
      !Array.isArray(operationPlans))fail('Supply the original merchant plan and complete authored operation records.');
  if(plan.payment?.network!==review.sheet.currency.network||plan.payment?.asset!==review.sheet.currency.asset)
    fail('The original plan must use the worksheet network and asset.');
  const inventory=new Map(operations.map(row=>[routeKey(row),row]));
  const currentRows=new Map(current.rows.map(row=>[routeKey(row),row]));
  const original=new Map(),additional=new Map();
  for(const row of plan.operations) {
    const key=routeKey(row),selection=currentRows.get(key);
    if(!inventory.has(key)||original.has(key)||!selection?.selected||atomicPrice(row.amountAtomic)!==selection.amountAtomic)
      fail('The original merchant plan must match the current selected routes and prices.');
    original.set(key,row);
  }
  if(original.size!==current.rows.filter(row=>row.selected).length)
    fail('Include every current selected operation in the original merchant plan.');
  for(const row of operationPlans) {
    if(!object(row)||typeof row.method!=='string'||typeof row.path!=='string')
      fail('Supply each new route as a complete authored native operation record.');
    const key=routeKey(row);
    if(!inventory.has(key)||additional.has(key))fail('Use each original source operation once in authored route records.');
    additional.set(key,row);
  }
  const selected=new Map(review.sheet.rows.filter(row=>row.selected).map(row=>[routeKey(row),row]));
  const ordered=[...plan.operations.filter(row=>selected.has(routeKey(row))),
    ...review.sheet.rows.filter(row=>row.selected&&!original.has(routeKey(row))).map(row=>{
      const authored=additional.get(routeKey(row));
      if(!authored)fail('Configure the original settings for '+row.method+' '+row.path+' before including it.');
      return authored;
    })];
  const result={...copy(plan),operations:ordered.map(row=>({...copy(row),
    amountAtomic:selected.get(routeKey(row)).amountAtomic}))};
  return {...review,plan:result};
}

export function routeSheetText(sheet) {return JSON.stringify(normalizeRouteSheet(sheet),null,2)+'\n';}
