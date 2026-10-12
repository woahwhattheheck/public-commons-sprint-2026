// MIT. Explicit merchant credit policies and source-bound invoice release assessments.
import {need,plain,field,identifier,dateValue,currencyOf,currencyKey,minor,money,today,json,sha,
  invoiceSummary,receiptSummary,invoiceDocument,customerSnapshot} from './core.mjs';
import {collectionRows,projectCollection} from './collections.mjs';
import {cashDate,cashCurrency,cashLabel} from './public/cash-planning-display.mjs';

export const CREDIT_POLICY_SCHEMA='stellar-forge.merchant-credit-policy.v1';
export const CREDIT_ASSESSMENT_SCHEMA='stellar-forge.merchant-credit-assessment.v1';
export const CREDIT_DECISION_SCHEMA='stellar-forge.merchant-credit-decision.v1';
const clone=value=>structuredClone(value),positive=value=>value>0n?value:0n,min=(a,b)=>a<b?a:b;
function register(data,key){
  need(data[key]===undefined||Array.isArray(data[key]),'INVALID_CREDIT_CONTROL_REGISTER',
    'The saved customer credit-control register is invalid.',409);
  return data[key]??[];
}
export const creditPolicyRows=data=>register(data,'creditPolicies');
export const creditDecisionRows=data=>register(data,'creditDecisions');
export function normalizeCreditTerms(value,currency){
  need(plain(value),'INVALID_CREDIT_POLICY','Enter the customer credit policy.');
  const bool=(key,fallback=false)=>{
    need(value[key]===undefined||typeof value[key]==='boolean','INVALID_CREDIT_POLICY','Choose a value for '+key+'.');
    return value[key]??fallback;
  };
  const enabled=bool('enabled'),reviewDisputes=bool('reviewDisputes'),reviewEveryOrder=bool('reviewEveryOrder');
  const creditLimit=value.creditLimit===undefined||value.creditLimit===null||value.creditLimit===''?null:
    money(minor(value.creditLimit,currency,'credit limit'),currency);
  const overdueDays=value.overdueDays===undefined||value.overdueDays===null?null:value.overdueDays;
  need(overdueDays===null||Number.isInteger(overdueDays)&&overdueDays>=0&&overdueDays<=3660,
    'INVALID_CREDIT_POLICY','Allowed overdue days must be a whole number from zero to 3660.');
  need(!enabled||creditLimit!==null||overdueDays!==null||reviewDisputes||reviewEveryOrder,
    'EMPTY_CREDIT_POLICY','Select at least one rule before enabling the customer policy.');
  return {enabled,creditLimit,overdueDays,reviewDisputes,reviewEveryOrder};
}
export function creditPolicySummary(row){
  return clone({id:row.id,version:row.version,customerId:row.customerId,customerName:row.customerName,
    currency:row.currency,owner:row.owner,terms:row.terms,createdAt:row.createdAt,updatedAt:row.updatedAt,
    editionCount:row.editions.length});
}
export function activeCreditPolicy(data,customerId,currency){
  const rows=creditPolicyRows(data).filter(row=>row.customerId===customerId&&currencyKey(row.currency)===currencyKey(currency));
  need(rows.length<=1,'DUPLICATE_CREDIT_POLICY','Review the original customer and currency policy identity.',409);
  return rows[0]??null;
}
export function currentCreditDecision(data,invoiceId){
  return [...creditDecisionRows(data)].reverse().find(row=>row.invoiceId===invoiceId&&
    ['APPROVED','DECLINED'].includes(row.status))??null;
}
export function creditDecisionSummary(row){
  const a=row.assessment;
  return clone({id:row.id,invoiceId:row.invoiceId,version:row.version,outcome:row.outcome,status:row.status,
    createdAt:row.createdAt,updatedAt:row.updatedAt,actor:row.actor,reason:row.reason,
    assessmentSha256:row.assessmentSha256,customerId:a.customer.id,customerName:a.customer.name,
    currency:a.invoice.currency,total:a.invoice.total,purchaseOrder:a.document.purchaseOrder||'',asOf:a.asOf,reviewRequired:a.reviewRequired,
    policyId:a.policy?.id??null,policyVersion:a.policy?.version??null,triggerCodes:a.triggers.map(item=>item.code),
    supersededById:row.supersededById??null,consumedAt:row.consumedAt??null,
    issuedInvoiceId:row.issuedInvoiceId??null,issuedNumber:row.issuedNumber??null});
}
export function assessCustomerCredit(data,invoice,customer,asOf=today()){
  dateValue(asOf,'current credit assessment date');
  need(invoice?.status==='DRAFT'&&!invoice.document,'CREDIT_DRAFT_REQUIRED','Choose an original editable invoice draft.',409);
  const document=invoiceDocument(invoice,customer,data.issuer),currency=document.currency,key=currencyKey(currency);
  const policyRow=activeCreditPolicy(data,customer.id,currency),policy=policyRow?creditPolicySummary(policyRow):null;
  const terms=policy?.terms,enabled=Boolean(terms?.enabled),invoices=[],receipts=[],creditInvoices=[],disputes=[];
  const sourceInvoices=[],sourceReceipts=[],sourceCases=[],invoiceIds=new Set(),receiptIds=new Set();
  let currentDue=0n,futureIssued=0n,overdue=0n,disputed=0n,availableReceipts=0n,invoiceCredits=0n;
  for(const row of data.invoices){
    if(!row.document||row.document.customerId!==customer.id||currencyKey(row.document.currency)!==key)continue;
    const summary=invoiceSummary(row,data,asOf);
    sourceInvoices.push(row);invoiceIds.add(row.id);
    const due=minor(summary.amountDue,currency);
    const future=row.document.issueDate>asOf&&(!row.voidDate||row.voidDate>asOf)?
      positive(minor(summary.total,currency)-minor(summary.paid,currency)-minor(summary.credited,currency)):0n;
    const savedCases=collectionRows(data).filter(item=>item.invoiceId===row.id);
    need(savedCases.length<=1,'DUPLICATE_COLLECTION_CASE','Review the original invoice case identity.',409);
    const caseView=savedCases.length?projectCollection(savedCases[0],data,asOf):null;
    if(savedCases.length)sourceCases.push(savedCases[0]);
    const open=caseView?.status!=='FUTURE'&&caseView?.dispute?.status==='OPEN'?caseView.dispute:null;
    const disputedUnits=open?min(minor(open.amount,currency),due):0n;
    const openDispute=disputedUnits>0n?{caseId:caseView.id,caseVersion:caseView.version,caseStatus:caseView.status,disputeId:open.id,
      amount:money(disputedUnits,currency),recordedAmount:open.amount,effectiveDate:open.effectiveDate,
      note:open.note,reference:open.reference,invoiceId:row.id,invoiceNumber:row.number}:null;
    if(openDispute)disputes.push(openDispute);
    currentDue+=due;futureIssued+=future;overdue+=summary.overdueDays>0?due:0n;disputed+=disputedUnits;
    const credit=minor(summary.creditBalance,currency);
    if(credit>0n){invoiceCredits+=credit;creditInvoices.push(summary);}
    invoices.push({...summary,exposureAmount:money(due+future,currency),futureExposure:money(future,currency),openDispute});
  }
  for(const row of data.receipts){
    if(row.customerId!==customer.id||currencyKey(row.currency)!==key)continue;
    sourceReceipts.push(row);receiptIds.add(row.id);
    const summary=receiptSummary(row,data,asOf),available=minor(summary.available,currency);
    availableReceipts+=available;
    if(available>0n)receipts.push(summary);
  }
  invoices.sort((a,b)=>a.issueDate.localeCompare(b.issueDate)||a.id.localeCompare(b.id));
  receipts.sort((a,b)=>a.receivedDate.localeCompare(b.receivedDate)||a.id.localeCompare(b.id));
  creditInvoices.sort((a,b)=>a.id.localeCompare(b.id));disputes.sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId));
  const otherDrafts=data.invoices.filter(row=>row.id!==invoice.id&&row.status==='DRAFT'&&
    row.draft.customerId===customer.id&&currencyKey(row.draft.currency)===key)
    .map(row=>({...invoiceSummary(row,data,asOf),purchaseOrder:row.draft.purchaseOrder||''})).sort((a,b)=>a.id.localeCompare(b.id));
  const draft={...invoiceSummary(invoice,data,asOf),purchaseOrder:document.purchaseOrder||''},draftTotal=minor(document.totals.total,currency);
  const issuedExposure=currentDue+futureIssued,projectedExposure=issuedExposure+draftTotal;
  const limit=enabled&&terms.creditLimit!==null?minor(terms.creditLimit,currency):null;
  const exposure={currentDue:money(currentDue,currency),futureIssued:money(futureIssued,currency),
    issuedExposure:money(issuedExposure,currency),overdue:money(overdue,currency),disputed:money(disputed,currency),
    availableReceipts:money(availableReceipts,currency),invoiceCredits:money(invoiceCredits,currency),
    draftTotal:money(draftTotal,currency),projectedExposure:money(projectedExposure,currency),
    creditLimit:limit===null?null:money(limit,currency),headroom:limit===null?null:money(limit-projectedExposure,currency)};
  const triggers=[];
  if(enabled&&limit!==null&&projectedExposure>limit)triggers.push({code:'CREDIT_LIMIT_EXCEEDED',
    message:'Issued exposure plus this draft exceeds the selected customer credit limit.',
    amount:money(projectedExposure-limit,currency)});
  if(enabled&&terms.overdueDays!==null){
    const rows=invoices.filter(row=>row.overdueDays>terms.overdueDays&&minor(row.amountDue,currency)>0n);
    if(rows.length)triggers.push({code:'OVERDUE_BALANCE',message:'Original unpaid invoices exceed the allowed overdue days.',
      amount:money(rows.reduce((n,row)=>n+minor(row.amountDue,currency),0n),currency),invoiceIds:rows.map(row=>row.id)});
  }
  if(enabled&&terms.reviewDisputes&&disputed>0n)triggers.push({code:'OPEN_DISPUTE',
    message:'The customer has an open disputed amount on an original unpaid invoice.',
    amount:money(disputed,currency),invoiceIds:disputes.map(row=>row.invoiceId)});
  if(enabled&&terms.reviewEveryOrder)triggers.push({code:'EVERY_ORDER_REVIEW',
    message:'The merchant policy requires an operator decision for each invoice.'});
  const stable=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
  const source={draftVersion:invoice.version,draftSha256:sha(json(invoice.draft)),previewSha256:sha(json(document)),
    customerVersion:customer.version??null,customerSha256:sha(json(customerSnapshot(customer))),
    policyId:policy?.id??null,policyVersion:policy?.version??null,
    issuedInvoicesSha256:sha(json(stable(sourceInvoices))),
    receiptsSha256:sha(json(stable(sourceReceipts))),
    allocationsSha256:sha(json(stable(data.allocations.filter(row=>invoiceIds.has(row.invoiceId)||receiptIds.has(row.receiptId))))),
    creditsSha256:sha(json(stable(data.credits.filter(row=>invoiceIds.has(row.invoiceId))))),
    collectionCasesSha256:sha(json(stable(sourceCases))),
    refundsSha256:sha(json(stable((data.refunds??[]).filter(row=>receiptIds.has(row.proposal?.receiptId))))),
    otherDraftsInformational:true};
  return clone({schema:CREDIT_ASSESSMENT_SCHEMA,asOf,invoiceId:invoice.id,invoice:draft,document,
    customer:customerSnapshot(customer),policy,exposure,invoices,receipts,creditInvoices,otherDrafts,disputes,
    triggers,reviewRequired:triggers.length>0,source});
}
export function creditAssessmentHash(assessment,workspaceId){
  const {otherDrafts,...basis}=assessment;
  return sha(json({workspaceId,assessment:basis}));
}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function creditDecisionHtml(row){
  const a=row.assessment,e=escape,c=a.invoice.currency;
  const metrics=[['Current invoice due','currentDue'],['Future issued balance','futureIssued'],['Issued exposure','issuedExposure'],
    ['Selected draft','draftTotal'],['Exposure after issue','projectedExposure'],['Overdue balance','overdue'],
    ['Open disputed balance','disputed'],['Available customer receipts','availableReceipts'],['Invoice credit balances','invoiceCredits']];
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+
    '<title>Customer credit decision</title><style>body{font:14px/1.5 system-ui;color:#222;margin:32px;max-width:1200px}'+
    'table{border-collapse:collapse;width:100%;margin:20px 0}td,th{padding:8px;border-bottom:1px solid #bbb;text-align:left;vertical-align:top}'+
    'pre{white-space:pre-wrap}.num{text-align:right}.muted{color:#555}@media print{tr{break-inside:avoid}}</style>'+
    '<h1>Customer credit decision</h1><p>'+e(a.customer.name)+' · '+e(cashCurrency(c))+' · '+e(cashLabel(row.status))+'</p>'+
    '<p>Assessed '+e(cashDate(a.asOf))+'; saved '+e(cashDate(row.createdAt))+' by '+e(row.actor)+'.</p>'+
    '<h2>Operator decision</h2><p>'+e(cashLabel(row.outcome))+'</p><pre>'+e(row.reason)+'</pre>'+
    (row.issuedNumber?'<p>Released as invoice '+e(row.issuedNumber)+' on '+e(cashDate(row.consumedAt))+'.</p>':'')+
    '<h2>Selected original draft</h2><p>'+e(row.issuedNumber?'Invoice '+row.issuedNumber:
      a.document.purchaseOrder?'Purchase order '+a.document.purchaseOrder:'Draft invoice')+
    ' · Issue '+e(cashDate(a.invoice.issueDate))+' · Due '+e(cashDate(a.invoice.dueDate))+'</p>'+
    '<table><thead><tr><th>Description</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>'+
    a.document.lines.map(line=>'<tr><td>'+e(line.description)+'</td><td>'+e(line.quantity)+'</td><td>'+e(line.total)+'</td></tr>').join('')+'</tbody></table>'+
    '<h2>Saved exposure</h2><table><thead><tr><th>Amount</th><th>Value</th></tr></thead><tbody>'+
    metrics.map(([name,key])=>'<tr><td>'+name+'</td><td>'+e(a.exposure[key])+'</td></tr>').join('')+
    '<tr><td>Credit limit</td><td>'+e(a.exposure.creditLimit??'No amount limit')+'</td></tr>'+
    '<tr><td>Headroom after issue</td><td>'+e(a.exposure.headroom??'No amount limit')+'</td></tr></tbody></table>'+
    '<p>Future issued balances use their original total less payments and credits effective on the assessment date. Available receipts and invoice credit balances keep their original allocations.</p>'+
    '<h2>Selected policy</h2>'+(a.policy?'<p>'+e(a.policy.owner)+' · Version '+a.policy.version+'</p><ul>'+
      '<li>Policy '+(a.policy.terms.enabled?'enabled':'disabled')+'</li><li>Credit limit '+e(a.policy.terms.creditLimit??'No amount limit')+'</li>'+
      '<li>Allowed overdue days '+e(a.policy.terms.overdueDays??'No overdue rule')+'</li><li>Open dispute review '+(a.policy.terms.reviewDisputes?'selected':'off')+
      '</li><li>Every-order review '+(a.policy.terms.reviewEveryOrder?'selected':'off')+'</li></ul>':'<p>No saved customer policy.</p>')+
    '<h2>Assessment findings</h2>'+(a.triggers.length?'<ul>'+a.triggers.map(item=>'<li>'+e(item.message)+
      (item.amount?' '+e(item.amount):'')+'</li>').join('')+'</ul>':'<p>The selected policy rules did not require an exception.</p>')+
    '<h2>Original customer invoices</h2><table><thead><tr><th>Invoice</th><th>Issue / due</th><th>Current due</th><th>Future issued</th><th>Overdue days</th><th>Open dispute</th></tr></thead><tbody>'+
    a.invoices.map(item=>'<tr><td>'+e(item.number)+'</td><td>'+e(cashDate(item.issueDate))+' / '+e(cashDate(item.dueDate))+
      '</td><td>'+e(item.amountDue)+'</td><td>'+e(item.futureExposure)+'</td><td>'+item.overdueDays+'</td><td>'+
      e(item.openDispute?item.openDispute.amount+' · Case '+cashLabel(item.openDispute.caseStatus):'None')+'</td></tr>').join('')+'</tbody></table>'+
    '<h2>Existing customer funds</h2><table><thead><tr><th>Original receipt</th><th>Received</th><th>Available</th></tr></thead><tbody>'+
    a.receipts.map(item=>'<tr><td>'+e(item.reference)+'</td><td>'+e(cashDate(item.receivedDate))+'</td><td>'+e(item.available)+'</td></tr>').join('')+'</tbody></table>'+
    '<table><thead><tr><th>Original invoice credit balance</th><th>Amount</th></tr></thead><tbody>'+
    a.creditInvoices.map(item=>'<tr><td>'+e(item.number)+'</td><td>'+e(item.creditBalance)+'</td></tr>').join('')+'</tbody></table>'+
    '<h2>Decision history</h2>'+row.history.map(item=>'<p>'+e(cashDate(item.at)+' · '+cashLabel(item.kind)+' · '+item.actor)+
      (item.reason?'<br>'+e(item.reason):'')+'</p>').join('')+
    '<details><summary>Original record references</summary><dl>'+
    '<dt>Draft invoice ID / version</dt><dd>'+e(a.invoiceId)+' / '+a.invoice.version+'</dd>'+
    '<dt>Credit decision ID / version</dt><dd>'+e(row.id)+' / '+row.version+'</dd>'+
    '<dt>Accounting workspace</dt><dd>'+e(row.workspaceId)+'</dd>'+
    '<dt>Assessment SHA256</dt><dd>'+e(row.assessmentSha256)+'</dd>'+
    (row.issuedDocumentSha256?'<dt>Issued document SHA256</dt><dd>'+e(row.issuedDocumentSha256)+'</dd>':'')+
    '</dl><pre>'+e(json(a.source))+'</pre></details>'+
    '<p class="muted">This report retains the original decision and source basis. The workspace rechecks that basis when issuing the invoice.</p></html>';
}
export function creditDecisionFiles(row){
  const files=[{name:'decision.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json(row))},
    {name:'decision.html',type:'text/html; charset=utf-8',bytes:Buffer.from(creditDecisionHtml(row))}];
  files.push({name:'manifest.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json({
    schema:'stellar-forge.merchant-credit-decision-files.v1',decisionId:row.id,decisionVersion:row.version,
    assessmentSha256:row.assessmentSha256,files:Object.fromEntries(files.map(file=>[file.name,{bytes:file.bytes.length,sha256:sha(file.bytes)}]))}))});
  return files;
}
