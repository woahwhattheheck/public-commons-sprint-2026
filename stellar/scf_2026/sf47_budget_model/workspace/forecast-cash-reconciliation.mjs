// MIT. Retained Forecast assumptions and actual original Cash records; no ledger writes.
import {signature} from './forecast-workbook.mjs';
export const CASH_REVIEW_SCHEMA='stellar-forge.forecast-cash-review.v1';
export const CASH_DESK_SCHEMA='stellar-forge.forecast-cash-desk.v1';
const cp=v=>JSON.parse(JSON.stringify(v)),obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k),same=(a,b)=>signature(a)===signature(b);
const need=(v,m)=>{if(!v)throw Error(m);};
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const allowed=(v,ks,label)=>{need(obj(v),'Retain '+label+'.');for(const k of Object.keys(v))need(ks.includes(k),'Unexpected '+label+' field: '+k);};
function ordinary(v,d=0){need(d<65,'The complete cash review exceeds the supported nesting.');if(Array.isArray(v)){need(v.length<=100000,'Retain a supported complete record collection.');for(const x of v)ordinary(x,d+1);}else if(obj(v)){for(const[k,x]of Object.entries(v)){need(!['__proto__','prototype','constructor'].includes(k),'Use ordinary source fields.');ordinary(x,d+1);}}else need(v===null||typeof v==='string'&&v.length<=30000000||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v),'Retain ordinary complete source JSON.');}
function date(v,label='date'){need(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Enter a complete calendar '+label+'.');return v;}
function note(v,label='review note',max=12000){need(typeof v==='string'&&v.trim()&&v.length<=max,'Enter '+label+' within '+max+' characters.');return v;}
function list(v,label,max=10000){need(Array.isArray(v)&&v.length<=max,'Retain the complete '+label+'.');return v;}
function index(rows,key='id'){const out=new Map;for(const r of rows){need(obj(r)&&typeof r[key]==='string'&&ID.test(r[key])&&!out.has(r[key]),'Retain unique original '+key+' identities.');out.set(r[key],r);}return out;}
function cents(v){if(v===null||v===undefined)return null;need(typeof v==='string'&&/^-?\d{1,30}(?:\.\d{1,2})?$/.test(v),'Retain exact original USD decimal text.');const neg=v.startsWith('-'),a=(neg?v.slice(1):v).split('.');return (neg?-1n:1n)*(BigInt(a[0])*100n+BigInt((a[1]||'').padEnd(2,'0')));}
const money=v=>v===null?null:(v<0n?'-':'')+String((v<0n?-v:v)/100n)+'.'+String((v<0n?-v:v)%100n).padStart(2,'0');
const add=(a,b)=>money(cents(a)+cents(b));
const target=(kind,id)=>({kind,id}),UNASSIGNED=Object.freeze({kind:'UNASSIGNED',id:null});
function targetKey(t){return t.kind==='UNASSIGNED'?'UNASSIGNED':t.kind+':'+t.id;}
function validTarget(t,inputs,current,cash){
  allowed(t,['kind','id'],'cash target');
  if(t.kind==='UNASSIGNED'){need(t.id===null,'Unassigned cash has no inferred target.');return;}
  need(typeof t.id==='string','Select an original target identity.');
  if(t.kind==='PACKAGE')need(current.plan.scenario.future_costs.some(r=>r.id===t.id),'Select an original pinned package.');
  else need(['CUSTOMER_RECEIPT','CUSTOMER_COST'].includes(t.kind)&&inputs.commercial.some(r=>r.id===t.id),'Select an original customer scenario.');
  if(cash){need(cash.state==='OBSERVED'&&cash.usdValue!==null&&!/testnet/i.test(cash.network||''),'Assign only valued, observed, non-testnet cash.');
    need(cash.date<=inputs.asOfDate,'Cash after the next Forecast as-of date remains unassigned in that Forecast.');
    if(t.kind==='CUSTOMER_RECEIPT')need(cash.direction==='IN'&&cash.category==='CUSTOMER','Use an original CUSTOMER inflow.');
    else need(cash.direction==='OUT'&&!cash.allocations.length,'Use an original direct outflow without invoice allocations.');}
}
function inputShape(v){need(obj(v)&&list(v.packageOverrides,'package estimates')&&list(v.commercial,'customer scenarios',50)&&list(v.invoiceOverrides,'invoice decisions')&&list(v.grantReceipts,'grant decisions',4)&&obj(v.openingCash)&&obj(v.capacity),'Retain complete original Forecast inputs.');index(v.packageOverrides,'costId');index(v.commercial);ordinary(v);return v;}
function sourceShape(current){
  need(obj(current)&&obj(current.program)&&/^operation-[a-f0-9]{32}$/.test(current.program.id)&&Number.isSafeInteger(current.program.version)&&current.program.version>0&&obj(current.plan)&&HASH.test(current.plan.contentSha256)&&obj(current.records),'Retain the original case and pinned plan.');
  index(list(current.records.cash,'original Cash records'));index(list(current.records.invoices,'original Invoices'));
  for(const row of current.records.cash){date(row.date,'cash date');need(['IN','OUT'].includes(row.direction)&&Array.isArray(row.allocations),'Retain original cash direction and allocations.');cents(row.usdValue);for(const a of row.allocations)need(typeof a.invoiceId==='string'&&cents(a.amountUsd)!==null,'Retain complete original invoice allocations.');}
  return current;
}
function savedBody(v){const x=cp(v);delete x.current;return x;}
export function captureCashReview(saved,current,inputs,{asOfDate=inputs.asOfDate}={}){
  ordinary(saved);sourceShape(current);inputShape(inputs);date(asOfDate,'review date');
  need(obj(saved)&&/^forecast-[a-f0-9]{32}$/.test(saved.id)&&HASH.test(saved.sha256)&&obj(saved.snapshot)&&obj(saved.inputs)&&obj(saved.report)&&Array.isArray(saved.report.events),'Select one complete saved original Forecast.');
  for(const event of saved.report.events){need(obj(event)&&typeof event.id==='string'&&typeof event.kind==='string','Retain every complete original Forecast event.');date(event.date,'planned cash date');need(cents(event.amountUsd)!==null,'Every dated native Forecast event must retain its exact valued USD amount.');}
  date(saved.inputs.asOfDate,'original Forecast date');need(asOfDate>=saved.inputs.asOfDate,'Review actual cash on or after the selected Forecast date.');
  const origins=new Set([current.program.id,current.program.origin?.programId].filter(Boolean));
  need(origins.has(saved.source.programId)||saved.current?.programId===current.program.id,'Select a Forecast from this same original or received case.');
  const cleanCurrent={program:cp(current.program),plan:cp(current.plan),records:cp(current.records),sources:cp(current.sources)};
  return {schema:CASH_REVIEW_SCHEMA,baseline:savedBody(saved),current:cleanCurrent,beforeInputs:cp(inputs),asOfDate};
}
export function validateCashReview(v,{caseId,originalSaved}={}){
  allowed(v,['schema','baseline','current','beforeInputs','asOfDate'],'complete cash review');need(v.schema===CASH_REVIEW_SCHEMA,'Open an original Forecast cash review.');
  const expected=captureCashReview({...v.baseline,current:{programId:v.current.program.id}},v.current,v.beforeInputs,{asOfDate:v.asOfDate});
  need(same(expected,v),'Retain the complete original cash review without discarded fields.');
  if(caseId)need(v.current.program.id===caseId,'Reopen this review in its original local case.');
  if(originalSaved)need(same(savedBody(originalSaved),v.baseline),'The selected original Forecast differs from the retained review.');
  return cp(v);
}
function assignments(inputs){
  const map=new Map;const append=(id,t)=>{need(typeof id==='string','Retain original cash identities.');const a=map.get(id)||[];a.push(t);map.set(id,a);};
  for(const r of inputs.packageOverrides)for(const id of r.directCashIds||[])append(id,target('PACKAGE',r.costId));
  for(const r of inputs.commercial){for(const id of r.cashIds||[])append(id,target('CUSTOMER_RECEIPT',r.id));for(const id of r.directCashIds||[])append(id,target('CUSTOMER_COST',r.id));}
  return map;
}
function oneAssignment(inputs,id){const rows=assignments(inputs).get(id)||[];return rows.length===0?cp(UNASSIGNED):rows.length===1?cp(rows[0]):{kind:'CONFLICT',id,targets:cp(rows)};}
function fieldRows(inputs){
  const rows=[{key:signature(['asOfDate']),path:['asOfDate'],label:'Next Forecast as-of date',value:inputs.asOfDate,nullable:false}];
  for(const[section,idKey,fields]of [['packageOverrides','costId',['startDate','endDate']],['invoiceOverrides','invoiceId',['dueDate']],['grantReceipts','tranche',['date']],['commercial','id',['startDate','endDate']]]){
    for(const r of inputs[section])for(const f of fields)rows.push({key:signature([section,r[idKey],f]),path:[section,r[idKey],f],label:section+' · '+r[idKey]+' · '+f,value:r[f]??null,nullable:section!=='commercial'||!!r.timing});
  }
  for(const r of inputs.commercial)for(const a of r.receipts||[])rows.push({key:signature(['commercial',r.id,'receipts',a.id,'date']),path:['commercial',r.id,'receipts',a.id,'date'],label:r.title+' · '+a.label+' · collection date',value:a.date??null,nullable:true});
  return rows;
}
export function cashDateFields(inputs){return cp(fieldRows(inputShape(inputs)));}
function fieldValue(inputs,path){
  if(path.length===1)return {exists:own(inputs,path[0]),value:inputs[path[0]]??null};
  const section=path[0],idKey={packageOverrides:'costId',invoiceOverrides:'invoiceId',grantReceipts:'tranche',commercial:'id'}[section],row=inputs[section]?.find(r=>r[idKey]===path[1]);
  if(!row)return {exists:false,value:null};
  if(path.length===5){const receipt=row.receipts?.find(r=>r.id===path[3]);return receipt?{exists:true,value:receipt.date??null}:{exists:false,value:null};}
  return {exists:true,value:row[path[2]]??null};
}
function setField(inputs,path,v){
  if(path.length===1){inputs[path[0]]=v;return;}
  const idKey={packageOverrides:'costId',invoiceOverrides:'invoiceId',grantReceipts:'tranche',commercial:'id'}[path[0]],r=inputs[path[0]].find(r=>r[idKey]===path[1]);need(r,'The original dated row is no longer in this draft.');
  if(path.length===5){const a=r.receipts.find(r=>r.id===path[3]);need(a,'The original receipt is no longer in this draft.');a.date=v;}else r[path[2]]=v;
}
function setAssignment(inputs,id,t){
  for(const p of inputs.packageOverrides)p.directCashIds=(p.directCashIds||[]).filter(x=>x!==id);
  for(const p of inputs.commercial){p.cashIds=(p.cashIds||[]).filter(x=>x!==id);p.directCashIds=(p.directCashIds||[]).filter(x=>x!==id);}
  if(t.kind==='UNASSIGNED')return;
  if(t.kind==='PACKAGE'){let p=inputs.packageOverrides.find(r=>r.costId===t.id);if(!p){p={costId:t.id,remainingCostUsd:null,remainingHours:null,startDate:null,endDate:null,paymentMode:'original',directCashIds:[],note:''};inputs.packageOverrides.push(p);}p.directCashIds.push(id);}
  else {const p=inputs.commercial.find(r=>r.id===t.id);need(p,'The reviewed customer no longer exists.');p[t.kind==='CUSTOMER_RECEIPT'?'cashIds':'directCashIds'].push(id);}
}
function selections(v,inputs,review){
  allowed(v,['assignments','dates','note'],'cash decisions');note(v.note);need(obj(v.assignments)&&obj(v.dates),'Retain complete selected assignments and date decisions.');
  const rows=index(review.current.records.cash),fields=new Map(fieldRows(review.beforeInputs).map(r=>[r.key,r]));
  for(const[id,t]of Object.entries(v.assignments)){need(rows.has(id),'The reviewed original cash record is unavailable.');validTarget(t,inputs,review.current,null);}
  for(const[k,val]of Object.entries(v.dates)){need(fields.has(k),'Select a date in the original reviewed Forecast.');if(val===null)need(fields.get(k).nullable,'This original work date must be entered.');else date(val);}
  return cp(v);
}
export function prepareCashDraft(review,decisions){
  validateCashReview(review);const proposed=cp(review.beforeInputs),selected=selections(decisions,proposed,review);
  const changes=[];const dates={...selected.dates,[signature(['asOfDate'])]:review.asOfDate};
  for(const[k,val]of Object.entries(dates)){const f=fieldRows(review.beforeInputs).find(r=>r.key===k);if(!same(f.value,val)){changes.push({key:'date:'+k,kind:'DATE',path:f.path,label:f.label,before:{exists:true,value:f.value},proposed:{exists:true,value:val}});setField(proposed,f.path,val);}}
  const cash=index(review.current.records.cash);
  for(const[id,t]of Object.entries(selected.assignments)){
    validTarget(t,proposed,review.current,cash.get(id));const before=oneAssignment(review.beforeInputs,id);
    if(!same(before,t)){changes.push({key:'cash:'+id,kind:'CASH',cashId:id,label:id,before,proposed:t});setAssignment(proposed,id,t);}
  }
  return {review:cp(review),decisions:selected,proposedInputs:proposed,changes};
}
export function reconcileCashDraft(currentInputs,review,decisions,{choices={}}={}){
  inputShape(currentInputs);need(obj(choices),'Retain complete current-source choices.');
  const proposal=prepareCashDraft(review,decisions),rows=[],after=cp(currentInputs),cash=index(review.current.records.cash),validChoices=new Set;
  for(const change of proposal.changes){
    const current=change.kind==='DATE'?fieldValue(currentInputs,change.path):oneAssignment(currentInputs,change.cashId);
    const conflict=!same(current,change.before)&&!same(current,change.proposed),basis=signature({key:change.key,before:change.before,current,proposed:change.proposed});
    const stored=choices[change.key];if(stored){need(conflict&&obj(stored)&&['CURRENT','PROPOSED'].includes(stored.value)&&stored.basis===basis,'A retained conflict decision no longer matches this complete draft.');validChoices.add(change.key);}
    const unresolved=conflict&&!stored,decision=unresolved?null:stored?.value||'PROPOSED';
    if(decision==='PROPOSED'){
      if(change.kind==='DATE'){need(current.exists,'The dated original row was removed; retain the current removal or restore it explicitly.');setField(after,change.path,change.proposed.value);}
      else setAssignment(after,change.cashId,change.proposed);
    }
    rows.push({...cp(change),current,conflict,basis,decision,unresolved});
  }
  for(const k of Object.keys(choices))need(validChoices.has(k),'A saved choice no longer names a current conflict.');
  const unresolved=rows.filter(r=>r.unresolved).length;
  if(!unresolved){
    for(const row of rows.filter(r=>r.kind==='CASH'&&r.decision==='PROPOSED'))validTarget(row.proposed,after,review.current,cash.get(row.cashId));
    const suffix='Cash review of '+review.baseline.id+' through '+review.asOfDate+': '+decisions.note;
    for(const row of rows.filter(r=>r.kind==='CASH'&&r.decision==='PROPOSED'&&r.proposed.kind!=='UNASSIGNED')){
      const t=row.proposed,p=t.kind==='PACKAGE'?after.packageOverrides.find(x=>x.costId===t.id):after.commercial.find(x=>x.id===t.id),max=t.kind==='PACKAGE'?4000:8000;
      if(!p.note?.includes(suffix))p.note=(p.note?p.note+'\n':'')+suffix;
      need(p.note.length<=max,'Shorten the reviewed assignment note within the original native field limit.');
    }
    if(rows.some(r=>r.decision==='PROPOSED'&&!same(r.current,r.proposed))&&!after.note.includes(suffix))after.note=(after.note?after.note+'\n':'')+suffix;
    need(after.note.length<=12000,'Keep the full Forecast note within its original 12,000-character limit.');
  }
  return {rows,unresolved,inputs:after,currentSignature:signature(currentInputs),changed:!same(after,currentInputs),nativePreviewRequired:true};
}
export function applyCashDraft(currentInputs,currentCase,review,decisions,{choices={},expectedSignature}={}){
  sourceShape(currentCase);need(currentCase.program.id===review.current.program.id&&currentCase.program.version===review.current.program.version&&same(currentCase.records,review.current.records)&&currentCase.plan.contentSha256===review.current.plan.contentSha256,'Original case records changed. Refresh the source and review the actual records again.');
  const result=reconcileCashDraft(currentInputs,review,decisions,{choices});need(expectedSignature===result.currentSignature,'The current Forecast changed after review. Reconcile its exact inputs before applying.');
  need(!result.unresolved,'Choose every current-versus-proposed decision before applying.');return cp(result.inputs);
}
function plannedGroup(event){if(event.kind==='FORECAST_CUSTOMER')return 'CUSTOMER_RECEIPT:'+(event.commercialId||event.id.split('/')[0]);if(event.kind==='COMMERCIAL_COST')return 'CUSTOMER_COST:'+event.id;if(event.kind==='CONDITIONAL_GRANT')return 'GRANT:'+event.id;return event.kind+':'+event.id;}
export function cashReviewReport(review,inputs=review.beforeInputs){
  validateCashReview(review);inputShape(inputs);const begin=review.baseline.inputs.asOfDate,end=review.asOfDate,groups=new Map,daily=new Map;
  const group=(key,title)=>{if(!groups.has(key))groups.set(key,{key,title,plannedUsd:0n,actualKnownUsd:0n,unvaluedCashIds:[],plannedEvents:[],actualAllocations:[]});return groups.get(key);};
  const day=stamp=>{if(!daily.has(stamp))daily.set(stamp,{date:stamp,plannedUsd:0n,attributedActualKnownUsd:0n,unassignedActualKnownUsd:0n,unvaluedCashIds:[]});return daily.get(stamp);};
  const period=d=>d>begin&&d<=end;
  for(const e of review.baseline.report.events){date(e.date);const g=group(plannedGroup(e),e.title||e.id);g.plannedEvents.push(cp(e));if(period(e.date)){g.plannedUsd+=cents(e.amountUsd);day(e.date).plannedUsd+=cents(e.amountUsd);}}
  const maps=assignments(inputs),rows=[],corrections=[],before=index(review.baseline.snapshot.records.cash),current=index(review.current.records.cash);
  let actualKnown=0n,attributed=0n,unassigned=0n;const unknown=[];
  for(const[id,old]of before){const now=current.get(id);if(!now||!same(now,old))corrections.push({cashId:id,before:cp(old),current:now?cp(now):null,kind:now?'CHANGED_RETAINED_RECORD':'MISSING_RETAINED_RECORD'});}
  const originalInvoices=index(review.baseline.snapshot.records.invoices),currentInvoices=index(review.current.records.invoices);
  for(const[id,old]of originalInvoices){const now=currentInvoices.get(id);if(!now||!same(now,old))corrections.push({invoiceId:id,before:cp(old),current:now?cp(now):null,kind:now?'CHANGED_RETAINED_INVOICE':'MISSING_RETAINED_INVOICE'});}
  if(review.baseline.snapshot.plan.contentSha256!==review.current.plan.contentSha256)corrections.push({kind:'PINNED_PLAN_CHANGED',before:review.baseline.snapshot.plan.contentSha256,current:review.current.plan.contentSha256});
  for(const source of review.current.records.cash){
    const cash=cp(source),valid=cash.state==='OBSERVED'&&!/testnet/i.test(cash.network||''),inPeriod=period(cash.date),value=cents(cash.usdValue),sign=cash.direction==='IN'?1n:-1n;
    const mapped=maps.get(cash.id)||[],parts=[],issues=[];
    if(!valid)issues.push(cash.state!=='OBSERVED'?'NOT_OBSERVED':'TESTNET_EXCLUDED');
    if(cash.date>end)issues.push('AFTER_REVIEW_DATE');
    if(cash.date<=begin)issues.push('AT_OR_BEFORE_ORIGINAL_AS_OF');
    if(value===null)issues.push('USD_VALUATION_MISSING');
    if(mapped.length>1)issues.push('AMBIGUOUS_DRAFT_ASSIGNMENT');
    const assigned=mapped.length===1?mapped[0]:null;
    if(cash.allocations.length){
      let total=0n;for(const a of cash.allocations){const amount=cents(a.amountUsd);need(amount>=0n,'Retain nonnegative original invoice allocations.');total+=amount;parts.push({key:'INVOICE:'+a.invoiceId,amountUsd:money(sign*amount),basis:'ORIGINAL_INVOICE_ALLOCATION'});}
      if(value!==null){need(total<=value,'Original invoice allocations exceed recorded cash.');if(value>total)parts.push({key:'UNASSIGNED',amountUsd:money(sign*(value-total)),basis:'UNALLOCATED_CASH_REMAINDER'});}
      else if(total!==0n)issues.push('ALLOCATIONS_WITHOUT_USD_VALUATION');
    }else if(cash.direction==='IN'&&cash.category==='GRANT'&&cash.tranche!==null&&cash.tranche!==undefined){parts.push({key:'GRANT:'+cash.tranche,amountUsd:money(value===null?null:sign*value),basis:'ORIGINAL_GRANT_TRANCHE'});}
    else if(assigned){
      try{validTarget(assigned,{...inputs,asOfDate:end},review.current,cash);parts.push({key:targetKey(assigned),amountUsd:money(value===null?null:sign*value),basis:'EXPLICIT_FORECAST_ASSIGNMENT'});}
      catch{issues.push('DRAFT_ASSIGNMENT_REQUIRES_REVIEW');parts.push({key:'UNASSIGNED',amountUsd:money(value===null?null:sign*value),basis:'UNRESOLVED_ASSIGNMENT'});}
    }else parts.push({key:'UNASSIGNED',amountUsd:money(value===null?null:sign*value),basis:'NO_INFERRED_CUSTOMER_OR_PACKAGE'});
    if(valid&&inPeriod){
      if(value===null){unknown.push(cash.id);day(cash.date).unvaluedCashIds.push(cash.id);}else actualKnown+=sign*value;
      for(const p of parts){const n=cents(p.amountUsd),g=group(p.key,p.key);g.actualAllocations.push({cashId:cash.id,date:cash.date,...p});
        if(n===null){g.unvaluedCashIds.push(cash.id);continue;}
        // A missing whole-record USD valuation cannot be represented as a known cash total.
        if(value===null){if(!g.unvaluedCashIds.includes(cash.id))g.unvaluedCashIds.push(cash.id);continue;}g.actualKnownUsd+=n;
        if(p.key==='UNASSIGNED'){unassigned+=n;day(cash.date).unassignedActualKnownUsd+=n;}
        else {attributed+=n;day(cash.date).attributedActualKnownUsd+=n;}}
    }
    rows.push({cash,inPeriod,included:valid&&inPeriod,parts,issues,originalAssignment:oneAssignment(inputs,cash.id)});
  }
  const resultGroups=[...groups.values()].map(g=>({...g,plannedUsd:money(g.plannedUsd),actualKnownUsd:money(g.actualKnownUsd),actualUsd:g.unvaluedCashIds.length?null:money(g.actualKnownUsd),
    recordedDifferenceUsd:g.key==='UNASSIGNED'||g.unvaluedCashIds.length?null:money(g.actualKnownUsd-g.plannedUsd),
    comparisonBasis:g.key==='UNASSIGNED'?'NO_PLANNED_SCOPE':'RECORDED_ATTRIBUTED_CASH_ONLY',cashCoverageAsserted:false})).sort((a,b)=>a.key.localeCompare(b.key));
  const staleDates=fieldRows(inputs).filter(r=>r.path.length>1&&r.value!==null&&r.value!==''&&r.value<=end);
  return {schema:CASH_REVIEW_SCHEMA+'.report',caseId:review.current.program.id,caseVersion:review.current.program.version,baseline:{id:review.baseline.id,sha256:review.baseline.sha256,asOfDate:begin},period:{after:begin,through:end},
    totals:{actualKnownUsd:money(actualKnown),actualUsd:unknown.length?null:money(actualKnown),attributedActualKnownUsd:money(attributed),unassignedActualKnownUsd:money(unassigned),unvaluedCashIds:unknown,recordCount:rows.filter(r=>r.included).length},
    groups:resultGroups,days:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({...r,plannedUsd:money(r.plannedUsd),attributedActualKnownUsd:money(r.attributedActualKnownUsd),unassignedActualKnownUsd:money(r.unassignedActualKnownUsd)})),
    cash:rows,sourceCorrections:corrections,staleDates,
    basis:'The selected saved Forecast remains unchanged. Actuals are the current recorded cash states on business dates strictly after its as-of date through the review date. Explicit original invoice/tranche links and reviewed Forecast assignments determine attribution. Unassigned and unvalued records stay visible; absence of a recorded payment is not proof that no payment occurred. Source corrections are separate. No bank reconciliation, payment, acceptance or new obligation is inferred.'};
}
function csvCell(v){let s=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[\t\r\n ]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function cashReviewCsv(report){const headers=['group','planned USD','recorded attributed USD','recorded difference USD','unknown cash IDs','basis'];return '\ufeff'+[headers,...report.groups.map(r=>[r.key,r.plannedUsd,r.actualUsd,r.recordedDifferenceUsd,r.unvaluedCashIds,r.comparisonBasis])].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export function emptyCashDesk(){return {schema:CASH_DESK_SCHEMA,forecastId:null,asOfDate:'',review:null,decisions:{assignments:{},dates:{},note:''},choices:{},search:'',page:0,history:[],retainedReviews:[]};}
export function validateCashDesk(v,{caseId,originalSaved}={}){
  allowed(v,['schema','forecastId','asOfDate','review','decisions','choices','search','page','history','retainedReviews'],'cash desk');
  need(v.schema===CASH_DESK_SCHEMA&&typeof v.asOfDate==='string'&&typeof v.search==='string'&&v.search.length<=2000&&Number.isSafeInteger(v.page)&&v.page>=0&&obj(v.choices),'Retain the complete cash desk selection.');
  need(v.forecastId===null||/^forecast-[a-f0-9]{32}$/.test(v.forecastId),'Select an original Forecast.');allowed(v.decisions,['assignments','dates','note'],'cash draft decisions');need(obj(v.decisions.assignments)&&obj(v.decisions.dates)&&typeof v.decisions.note==='string'&&v.decisions.note.length<=12000,'Retain all unfinished cash decisions.');
  if(v.review){validateCashReview(v.review,{caseId,originalSaved});}
  if(own(v,'retainedReviews'))for(const r of list(v.retainedReviews,'retained unfinished source reviews',100)){allowed(r,['review','decisions','choices'],'retained source review');validateCashReview(r.review,{caseId});need(obj(r.decisions)&&obj(r.choices),'Retain complete earlier source decisions.');ordinary(r);}
  list(v.history,'applied cash reviews',100);for(const h of v.history){allowed(h,['review','decisions','choices','beforeInputs','afterInputs','appliedAt'],'applied cash review');validateCashReview(h.review,{caseId});need(typeof h.appliedAt==='string'&&!Number.isNaN(Date.parse(h.appliedAt)),'Retain the original application time.');const r=reconcileCashDraft(h.beforeInputs,h.review,h.decisions,{choices:h.choices});need(!r.unresolved&&same(r.inputs,h.afterInputs),'Retain the complete original applied cash review and exact result.');}
  ordinary(v);return cp(v);
}
