// MIT. Saved receipt-planning scenarios over the original invoice, installment and case records.
import {need, plain, field, identifier, dateValue, currencyKey, minor, money, invoiceSummary, receiptSummary, json, sha, today} from './core.mjs';
import {editionAt, planProjection, addDays} from './payment-plans/core.mjs';
import {collectionRows, projectCollection} from './collections.mjs';
import {cashDate,cashCurrency,cashLabel} from './public/cash-planning-display.mjs';

export const CASH_PLAN_SCHEMA = 'stellar-forge.merchant-cash-plan.v1';
export const CASH_FORECAST_SCHEMA = 'stellar-forge.merchant-cash-forecast.v1';
export const CASH_COMPARISON_SCHEMA = 'stellar-forge.merchant-cash-plan-comparison.v1';
const min = (a,b) => a < b ? a : b;
const positive = value => value > 0n ? value : 0n;
const clone = value => structuredClone(value);
const currencySort = (a,b) => currencyKey(a.currency).localeCompare(currencyKey(b.currency));
export function cashPlanningRows(data) {
  need(data.cashPlans === undefined || Array.isArray(data.cashPlans), 'INVALID_CASH_PLAN_REGISTER',
    'The retained cash-plan register is invalid.', 409);
  return data.cashPlans ?? [];
}
function days(value, name) {
  need(Number.isInteger(value) && value >= 0 && value <= 3660, 'INVALID_CASH_PLAN_DELAY',
    name + ' must be a whole number from 0 to 3660 days.');
  return value;
}
export function normalizeCashPlan(value) {
  need(plain(value), 'INVALID_CASH_PLAN', 'Enter the collection planning assumptions.');
  const asOf = dateValue(value.asOf ?? today(), 'account date'), through = dateValue(value.through, 'last planning date');
  const horizon = (Date.parse(through + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / 86400000;
  need(horizon >= 0 && horizon <= 3660, 'INVALID_CASH_PLAN_HORIZON',
    'Choose a horizon from the account date through 3660 days later.');
  const bucket = value.bucket ?? 'WEEK';
  need(['DAY','WEEK','MONTH'].includes(bucket), 'INVALID_CASH_PLAN_BUCKET', 'Choose daily, weekly or monthly periods.');
  const disputes = value.disputes ?? 'SEPARATE';
  need(['SEPARATE','INCLUDE'].includes(disputes), 'INVALID_CASH_PLAN_DISPUTES',
    'Choose whether to separate open disputed amounts or include them in this scenario.');
  need(value.usePromises === undefined || typeof value.usePromises === 'boolean', 'INVALID_CASH_PLAN_PROMISES',
    'Choose whether this scenario uses open recorded promises.');
  need(value.overrides === undefined || Array.isArray(value.overrides), 'INVALID_CASH_PLAN_OVERRIDES',
    'Enter invoice date or exclusion assumptions.');
  const ids = new Set(), overrides = (value.overrides ?? []).map(item => {
    need(plain(item), 'INVALID_CASH_PLAN_OVERRIDE', 'Check the invoice assumption.');
    const invoiceId = identifier(item.invoiceId, 'invoice');
    need(!ids.has(invoiceId), 'DUPLICATE_CASH_PLAN_OVERRIDE', 'Keep one explicit assumption per invoice.');
    ids.add(invoiceId);
    need(['DATE','EXCLUDE'].includes(item.mode), 'INVALID_CASH_PLAN_OVERRIDE', 'Choose an expected date or separate this invoice.');
    const expectedDate = item.mode === 'DATE' ? dateValue(item.expectedDate, 'expected receipt date') : null;
    need(!expectedDate || expectedDate >= asOf, 'INVALID_CASH_PLAN_EXPECTED_DATE',
      'An explicit expected receipt date must be on or after the account date.');
    return {invoiceId,mode:item.mode,expectedDate,reason:field(item.reason, 'invoice assumption reason', 1500)};
  }).sort((a,b) => a.invoiceId.localeCompare(b.invoiceId));
  return {title:field(value.title,'plan title',300),owner:field(value.owner,'plan owner',160),
    note:field(value.note ?? '','plan note',6000,true),asOf,through,bucket,
    customerId:value.customerId ? identifier(value.customerId,'customer') : null,
    pastDueDelayDays:days(value.pastDueDelayDays ?? 0,'Past-due delay'),
    futureDelayDays:days(value.futureDelayDays ?? 0,'Future delay'),
    usePromises:value.usePromises ?? true,disputes,overrides};
}
function windows(plan) {
  const result = [];
  for (let from = plan.asOf; from <= plan.through;) {
    let through;
    if (plan.bucket === 'MONTH') {
      const date = new Date(from + 'T00:00:00Z'); date.setUTCMonth(date.getUTCMonth()+1,1); date.setUTCDate(0);
      through = date.toISOString().slice(0,10);
    } else {
      const remaining=(Date.parse(plan.through+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
      through=addDays(from,Math.min(remaining,plan.bucket==='WEEK'?6:0));
    }
    if (through > plan.through) through = plan.through;
    result.push({from,through});
    if (through === plan.through) break;
    from = addDays(through,1);
  }
  return result;
}
function periodIndex(date,plan) {
  if (plan.bucket === 'MONTH') return (Number(date.slice(0,4))-Number(plan.asOf.slice(0,4)))*12 +
    Number(date.slice(5,7))-Number(plan.asOf.slice(5,7));
  const days = (Date.parse(date+'T00:00:00Z')-Date.parse(plan.asOf+'T00:00:00Z'))/86400000;
  return Math.floor(days/(plan.bucket === 'WEEK'?7:1));
}
function consume(rows,amount,reverse=false) {
  let rest=amount;
  for (const row of reverse ? [...rows].reverse() : rows) {
    const used=min(row.units,rest); row.units-=used; rest-=used;
    if (rest===0n) break;
  }
  need(rest===0n,'CASH_PLAN_ALLOCATION_MISMATCH','The scenario must consume only the original invoice remainder.',409);
}
function eligiblePlans(data,invoiceId,asOf) {
  const saved=data.paymentPlans;
  need(saved === undefined || saved?.schema === 'stellar-forge.merchant-payment-plans.v1' && Array.isArray(saved.plans),
    'INVALID_PAYMENT_PLAN_WORKSPACE','The original payment-plan register is invalid.',409);
  return (saved?.plans ?? []).filter(row => row.invoiceId===invoiceId && editionAt(row,asOf) &&
    (!row.cancelledDate || row.cancelledDate>asOf));
}
function sourceIssue(code,message,sourceId=null) { return {code,message,sourceId}; }
export function projectCashPlan(data,input) {
  const plan=normalizeCashPlan(input), periods=windows(plan), invoices=[], accountInvoices=[], lines=[], groups=new Map(), applied=new Set();
  const overrides=new Map(plan.overrides.map(row=>[row.invoiceId,row]));
  for (const override of plan.overrides) need(data.invoices.some(row=>row.id===override.invoiceId && row.document),
    'CASH_PLAN_INVOICE_NOT_FOUND','An invoice assumption must retain its original issued invoice.',409);
  const group=currency=>{
    const key=currencyKey(currency);
    if(!groups.has(key))groups.set(key,{currency,invoices:0,amountDue:0n,withinHorizon:0n,afterHorizon:0n,separated:0n,
      reviewRequired:0n,periods:periods.map(row=>({...row,amount:0n}))});
    return groups.get(key);
  };
  const expectedDate=date=>date<plan.asOf ? addDays(plan.asOf,plan.pastDueDelayDays) : addDays(date,plan.futureDelayDays);
  for (const invoice of data.invoices) {
    if (!invoice.document || plan.customerId && invoice.document.customer.id!==plan.customerId) continue;
    const original=invoiceSummary(invoice,data,plan.asOf), balance=minor(original.amountDue,original.currency);
    accountInvoices.push(original);
    if (balance===0n) continue;
    const currency=original.currency, override=overrides.get(invoice.id), issues=[];
    const scheduled=eligiblePlans(data,invoice.id,plan.asOf);
    let schedule=null, portions=[];
    if(scheduled.length>1) issues.push(sourceIssue('OVERLAPPING_PAYMENT_PLANS',
      'The invoice has overlapping effective schedules. Choose its expected date after reviewing those editions.',invoice.id));
    else if(scheduled.length===1) {
      try {
        schedule=planProjection(scheduled[0],data,plan.asOf);
        if(schedule.baselineChanged)issues.push(sourceIssue('PAYMENT_PLAN_BASIS_CHANGED',
          'The original balance date differs from the retained installment basis.',schedule.id));
        portions=schedule.installments.filter(row=>minor(row.remaining,currency)>0n).map(row=>({
          source:'INSTALLMENT',sourceId:row.id,planId:schedule.id,editionId:schedule.editionId,
          originalDate:row.dueDate,units:minor(row.remaining,currency)}));
        const residue=minor(schedule.unscheduledAmount,currency);
        if(residue>0n)portions.push({source:'INVOICE',sourceId:invoice.id,originalDate:original.dueDate,units:residue});
      } catch(error) {
        if(error.code!=='PAYMENT_PLAN_LEDGER_CHANGED')throw error;
        issues.push(sourceIssue(error.code,error.message,scheduled[0].id));
      }
    } else portions=[{source:'INVOICE',sourceId:invoice.id,originalDate:original.dueDate,units:balance}];
    portions.sort((a,b)=>a.originalDate.localeCompare(b.originalDate)||a.sourceId.localeCompare(b.sourceId));
    const savedCases=collectionRows(data).filter(row=>row.invoiceId===invoice.id);
    need(savedCases.length<=1,'DUPLICATE_COLLECTION_CASE','Review the original invoice case identity.',409);
    const caseView=savedCases.length?projectCollection(savedCases[0],data,plan.asOf):null;
    const activeCase=caseView?.status==='OPEN'?caseView:null;
    const promise=plan.usePromises && activeCase?.promise?.status==='OPEN'?activeCase.promise:null;
    const dispute=activeCase?.dispute?.status==='OPEN'?activeCase.dispute:null;
    let remainingPromise=0n,promiseBasis=null;
    if(promise) {
      const retained=promise.invoiceBasis;
      need(retained?.asOf,'INVALID_COLLECTION_PROMISE_BASIS','The original promise must retain its invoice balance date.',409);
      const recomputed=invoiceSummary(invoice,data,dateValue(retained.asOf,'promise basis date'));
      const changed=['paid','credited','amountDue'].some(key=>recomputed[key]!==retained[key]);
      promiseBasis={asOf:retained.asOf,retained:clone(retained),recomputed,changed};
      if(changed)issues.push(sourceIssue('COLLECTION_PROMISE_BASIS_CHANGED',
        'The original balance date differs from the retained promise basis.',promise.id));
      const laterPaid=positive(minor(original.paid,currency)-minor(recomputed.paid,currency));
      remainingPromise=positive(minor(promise.amount,currency)-laterPaid);
      promiseBasis.laterAllocated=money(laterPaid,currency);
      promiseBasis.remainingBeforeCap=money(remainingPromise,currency);
    }
    const basis={...original,invoiceDocumentSha256:sha(json(invoice.document)),
      plan:schedule?{id:schedule.id,editionId:schedule.editionId,scheduleSha256:schedule.scheduleSha256,
        baselineChanged:schedule.baselineChanged}:null,
      applicablePlanIds:scheduled.map(row=>row.id),
      case:caseView?{id:caseView.id,version:caseView.version,status:caseView.status,
        promiseId:promise?.id??null,disputeId:dispute?.id??null}:null,promiseBasis,issues,override:override??null};
    const own=[];
    const add=(source,units,originalDate,date,reason,extra={})=>{
      if(units===0n)return;
      own.push({invoiceId:invoice.id,invoiceNumber:original.number,customerId:original.customerId,
        customerName:original.customerName,currency,source,originalDate,expectedDate:date,reason,
        ...extra,units});
    };
    if(override) {
      applied.add(invoice.id);
      add(override.mode==='EXCLUDE'?'OPERATOR_SEPARATED':'OPERATOR_DATE',balance,original.dueDate,
        override.expectedDate,override.reason,{sourceId:invoice.id});
    } else if(issues.length) {
      add('REVIEW_REQUIRED',balance,original.dueDate,null,
        issues.map(row=>row.message).join(' '),{sourceId:invoice.id});
    } else {
      need(portions.reduce((n,row)=>n+row.units,0n)===balance,'CASH_PLAN_SOURCE_MISMATCH',
        'The original schedule remainder must match the invoice balance.',409);
      if(dispute && plan.disputes==='SEPARATE') {
        const held=min(minor(dispute.amount,currency),balance);consume(portions,held,true);
        add('DISPUTED',held,dispute.effectiveDate,null,'Open disputed amount separated by this scenario.',
          {sourceId:dispute.id,caseId:activeCase.id});
      }
      if(promise) {
        const available=portions.reduce((n,row)=>n+row.units,0n),amount=min(remainingPromise,available);
        consume(portions,amount);
        add('PROMISE',amount,promise.dueDate,expectedDate(promise.dueDate),
          'Open recorded promise after later original allocations.',{sourceId:promise.id,caseId:activeCase.id});
      }
      for(const portion of portions)add(portion.source,portion.units,portion.originalDate,expectedDate(portion.originalDate),
        portion.source==='INSTALLMENT'?'Remaining original installment.':'Original invoice remainder.',
        {sourceId:portion.sourceId,...(portion.planId?{planId:portion.planId,editionId:portion.editionId}:{})});
    }
    need(own.reduce((n,row)=>n+row.units,0n)===balance,'CASH_PLAN_BALANCE_MISMATCH',
      'Every invoice balance must appear exactly once in the collection plan.',409);
    const total=group(currency);total.invoices++;total.amountDue+=balance;
    const invoiceTotals={withinHorizon:0n,afterHorizon:0n,separated:0n,reviewRequired:0n};
    for(const row of own) {
      const position=row.expectedDate===null?'SEPARATED':row.expectedDate>plan.through?'AFTER_HORIZON':'WITHIN_HORIZON';
      const key=position==='SEPARATED'?'separated':position==='AFTER_HORIZON'?'afterHorizon':'withinHorizon';
      total[key]+=row.units;invoiceTotals[key]+=row.units;
      if(row.source==='REVIEW_REQUIRED'){total.reviewRequired+=row.units;invoiceTotals.reviewRequired+=row.units;}
      if(position==='WITHIN_HORIZON')total.periods[periodIndex(row.expectedDate,plan)].amount+=row.units;
      const {units,...record}=row;lines.push({...record,position,amount:money(units,currency),sourceIssues:issues.map(issue=>issue.code)});
    }
    invoices.push({...basis,...Object.fromEntries(Object.entries(invoiceTotals).map(([key,value])=>[key,money(value,currency)]))});
  }
  lines.sort((a,b)=>(a.expectedDate??'9999-99-99').localeCompare(b.expectedDate??'9999-99-99')||
    currencyKey(a.currency).localeCompare(currencyKey(b.currency))||a.invoiceId.localeCompare(b.invoiceId)||
    a.originalDate.localeCompare(b.originalDate)||a.sourceId.localeCompare(b.sourceId));
  const currencies=[...groups.values()].sort(currencySort).map(row=>{
    need(row.withinHorizon+row.afterHorizon+row.separated===row.amountDue,'CASH_PLAN_TOTAL_MISMATCH',
      'Currency totals must reconcile to the original invoice balances.',409);
    let cumulative=0n;
    return {...row,...Object.fromEntries(['amountDue','withinHorizon','afterHorizon','separated','reviewRequired']
      .map(key=>[key,money(row[key],row.currency)])),
      periods:row.periods.map(period=>{cumulative+=period.amount;return {...period,amount:money(period.amount,row.currency),
        cumulative:money(cumulative,row.currency)};})};
  });
  const dueAccounts=new Set(invoices.map(row=>row.customerId+':'+currencyKey(row.currency))),funds=new Map();
  const accountFunds=(customerId,currency)=>{
    const key=customerId+':'+currencyKey(currency);
    if(!funds.has(key))funds.set(key,{customerId,customerName:invoices.find(row=>row.customerId===customerId)?.customerName||customerId,
      currency,availableReceipts:0n,invoiceCredits:0n,receipts:[],creditInvoices:[]});
    return funds.get(key);
  };
  for(const receipt of data.receipts??[]) {
    if(!dueAccounts.has(receipt.customerId+':'+currencyKey(receipt.currency)))continue;
    const summary=receiptSummary(receipt,data,plan.asOf),amount=minor(summary.available,summary.currency);
    if(amount===0n)continue;
    const row=accountFunds(receipt.customerId,summary.currency);row.availableReceipts+=amount;
    row.receipts.push({id:receipt.id,reference:receipt.reference,receivedDate:receipt.receivedDate,available:summary.available});
  }
  for(const invoice of accountInvoices) {
    if(!dueAccounts.has(invoice.customerId+':'+currencyKey(invoice.currency)))continue;
    const amount=minor(invoice.creditBalance,invoice.currency);if(amount===0n)continue;
    const row=accountFunds(invoice.customerId,invoice.currency);row.invoiceCredits+=amount;
    row.creditInvoices.push({id:invoice.id,number:invoice.number,creditBalance:invoice.creditBalance});
  }
  const customerFunds=[...funds.values()].sort((a,b)=>a.customerId.localeCompare(b.customerId)||currencySort(a,b))
    .map(row=>({...row,availableReceipts:money(row.availableReceipts,row.currency),invoiceCredits:money(row.invoiceCredits,row.currency)}));
  return clone({schema:CASH_FORECAST_SCHEMA,plan,invoices,lines,currencies,customerFunds,
    inactiveOverrides:plan.overrides.filter(row=>!applied.has(row.invoiceId)).map(row=>({...row,
      reasonInView:'No outstanding invoice balance in this selected account/customer view.'})),
    sourceIssues:invoices.flatMap(row=>row.issues.map(issue=>({...issue,invoiceId:row.id,
      invoiceNumber:row.number,amountDue:row.amountDue,currency:row.currency,operatorOverride:Boolean(row.override)})))});
}
export function cashPlanSummary(row) {
  const edition=row.editions.at(-1);
  return {id:row.id,version:row.version,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt,
    title:edition.plan.title,owner:edition.plan.owner,asOf:edition.plan.asOf,through:edition.plan.through,
    customerId:edition.plan.customerId,editionId:edition.id,editionNumber:edition.number,
    sourceRevision:edition.sourceRevision,currencies:clone(edition.projection.currencies),editionCount:row.editions.length};
}
export function compareCashPlans(left,right) {
  const currencies=new Map();
  for(const edition of [left,right])for(const row of edition.projection.currencies)currencies.set(currencyKey(row.currency),row.currency);
  const metrics=['amountDue','withinHorizon','afterHorizon','separated','reviewRequired'];
  const totals=[...currencies.values()].sort((a,b)=>currencyKey(a).localeCompare(currencyKey(b))).map(currency=>{
    const a=left.projection.currencies.find(row=>currencyKey(row.currency)===currencyKey(currency));
    const b=right.projection.currencies.find(row=>currencyKey(row.currency)===currencyKey(currency));
    return {currency,...Object.fromEntries(metrics.map(key=>[key,{left:a?.[key]??money(0n,currency),
      right:b?.[key]??money(0n,currency),change:money(minor(b?.[key]??money(0n,currency),currency)-
        minor(a?.[key]??money(0n,currency),currency),currency)}]))};
  });
  const dates=new Map();
  for(const [side,edition] of [['left',left],['right',right]])for(const row of edition.projection.lines) {
    if(row.position!=='WITHIN_HORIZON')continue;
    const key=currencyKey(row.currency)+':'+row.expectedDate;
    if(!dates.has(key))dates.set(key,{date:row.expectedDate,currency:row.currency,left:0n,right:0n});
    dates.get(key)[side]+=minor(row.amount,row.currency);
  }
  return {schema:CASH_COMPARISON_SCHEMA,
    left:{id:left.id,planId:left.planId,number:left.number,sourceRevision:left.sourceRevision,plan:clone(left.plan)},
    right:{id:right.id,planId:right.planId,number:right.number,sourceRevision:right.sourceRevision,plan:clone(right.plan)},
    currencies:totals,dates:[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date)||currencySort(a,b))
      .map(row=>({...row,left:money(row.left,row.currency),right:money(row.right,row.currency),
        change:money(row.right-row.left,row.currency)}))};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function csvCell(value) {
  let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
const csv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
export function cashPlanCsv(projection) {
  return csv([['invoice_id','invoice','customer','currency','precision','source','source_id','plan_id','edition_id','case_id',
    'original_date','expected_date','position','amount','reason','source_issues'],
    ...projection.lines.map(row=>[row.invoiceId,row.invoiceNumber,row.customerName,row.currency.code,row.currency.scale,
      row.source,row.sourceId,row.planId,row.editionId,row.caseId,row.originalDate,row.expectedDate,row.position,row.amount,row.reason,row.sourceIssues.join(' | ')])]);
}
export function cashPlanHtml(edition) {
  const p=edition.projection, e=escape;
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+
    '<title>'+e(edition.plan.title)+'</title><style>body{font:14px/1.5 system-ui;color:#222;margin:32px;max-width:1200px}'+
    'table{border-collapse:collapse;width:100%;margin:20px 0}td,th{padding:8px;border-bottom:1px solid #bbb;text-align:left;vertical-align:top}'+
    '.num{text-align:right;white-space:nowrap}pre{white-space:pre-wrap}.muted{color:#555}@media print{tr{break-inside:avoid}}</style>'+
    '<h1>'+e(edition.plan.title)+'</h1><p>Owner '+e(edition.plan.owner)+' · Edition '+edition.number+
    ' · Account date '+e(cashDate(edition.plan.asOf))+' · Through '+e(cashDate(edition.plan.through))+'</p><p class="muted">Saved '+
    e(cashDate(edition.createdAt))+' by '+e(edition.actor)+' from original accounting revision '+edition.sourceRevision+
    '.</p><p>Past-due delay '+edition.plan.pastDueDelayDays+' days; future delay '+edition.plan.futureDelayDays+
    ' days; recorded promises '+(edition.plan.usePromises?'included':'omitted')+'; disputed amounts '+
    e(edition.plan.disputes.toLowerCase())+'.</p><pre>'+e(edition.plan.note)+'</pre>'+
    '<h2>Original balance allocation</h2><table><thead><tr><th>Currency</th><th>Original due</th><th>Within horizon</th><th>After horizon</th><th>Separated</th><th>Of separated: awaiting review</th></tr></thead><tbody>'+
    p.currencies.map(row=>'<tr><td>'+e(cashCurrency(row.currency))+'</td><td>'+row.amountDue+
      '</td><td>'+row.withinHorizon+'</td><td>'+row.afterHorizon+'</td><td>'+row.separated+'</td><td>'+row.reviewRequired+'</td></tr>').join('')+
    '</tbody></table>'+p.currencies.map(row=>'<h2>'+e(row.currency.code)+' receipt periods</h2><table><thead><tr><th>From</th><th>Through</th><th>Expected receipts</th><th>Cumulative</th></tr></thead><tbody>'+
      row.periods.map(period=>'<tr><td>'+e(cashDate(period.from))+'</td><td>'+e(cashDate(period.through))+'</td><td>'+period.amount+'</td><td>'+period.cumulative+'</td></tr>').join('')+'</tbody></table>').join('')+
    (p.customerFunds.length?'<h2>Existing customer funds</h2><p>Review available receipts and invoice credits in the original account before planning new receipts. Their current saved allocation determines each invoice balance.</p>'+
      '<table><thead><tr><th>Customer</th><th>Currency</th><th>Available receipts</th><th>Invoice credits</th></tr></thead><tbody>'+
      p.customerFunds.map(row=>'<tr><td>'+e(row.customerName)+'</td><td>'+e(cashCurrency(row.currency))+
        '</td><td>'+row.availableReceipts+'</td><td>'+row.invoiceCredits+'</td></tr>').join('')+'</tbody></table>':'')+
    '<h2>Invoice allocation</h2><table><thead><tr><th>Invoice / customer</th><th>Source</th><th>Original date</th><th>Expected date</th><th>Position</th><th>Amount</th><th>Reason</th></tr></thead><tbody>'+
    p.lines.map(row=>'<tr><td>'+e(row.invoiceNumber)+'<br>'+e(row.customerName)+'</td><td>'+e(cashLabel(row.source))+
      '</td><td>'+e(cashDate(row.originalDate))+'</td><td>'+e(row.expectedDate?cashDate(row.expectedDate):'Separated')+'</td><td>'+e(cashLabel(row.position))+
      '</td><td class="num">'+e(row.currency.code+' '+row.amount)+'</td><td>'+e(row.reason)+'</td></tr>').join('')+'</tbody></table>'+
    (p.sourceIssues.length?'<h2>Source changes and operator decisions</h2><ul>'+p.sourceIssues.map(row=>'<li>'+
      e(row.invoiceNumber+' · '+row.code+' · '+row.message)+(row.operatorOverride?' An explicit invoice assumption supplies its date or separation.':'')+'</li>').join('')+'</ul>':'')+
    (p.inactiveOverrides.length?'<h2>Assumptions outside this account view</h2><ul>'+p.inactiveOverrides.map(row=>'<li>'+
      e(row.invoiceId+' · '+row.reasonInView)+'</li>').join('')+'</ul>':'')+
    '<p class="muted">Expected dates express the retained operator scenario. Original invoice, installment, promise and payment records remain available through their source identities.</p></html>';
}
export function cashPlanFiles(edition) {
  const files=[
    {name:'plan.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json(edition))},
    {name:'plan.csv',type:'text/csv; charset=utf-8',bytes:Buffer.from(cashPlanCsv(edition.projection))},
    {name:'plan.html',type:'text/html; charset=utf-8',bytes:Buffer.from(cashPlanHtml(edition))}];
  files.push({name:'manifest.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json({
    schema:'stellar-forge.merchant-cash-plan-files.v1',editionId:edition.id,reviewSha256:edition.reviewSha256,
    files:Object.fromEntries(files.map(row=>[row.name,{bytes:row.bytes.length,sha256:sha(row.bytes)}]))}))});
  return files;
}
export function cashPlanComparisonCsv(comparison) {
  return csv([['date','currency','precision','left_receipts','right_receipts','right_minus_left'],
    ...comparison.dates.map(row=>[row.date,row.currency.code,row.currency.scale,row.left,row.right,row.change])]);
}
