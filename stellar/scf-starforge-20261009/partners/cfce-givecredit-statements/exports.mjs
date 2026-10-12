// MIT. Complete frozen statements and operator tables, with readable customer presentation.
import {decimal,dayOf} from './source.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const readableDate=value=>value?new Date(dayOf(value)+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):'—';
export const methodLabel=value=>({PROPORTIONAL_GROSS:'Proportional to original gross payments',FIFO_GROSS:'Oldest available provider contributions first',EXPLICIT:'Explicit token amounts'}[value]||value);
function csvCell(value){
  let result=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
  if(/^[=+@]/.test(result)||/^-/.test(result)&&!/^-\d+(?:\.\d+)?$/.test(result))result="'"+result;
  return '"'+result.replace(/"/g,'""')+'"';
}
export function csv(columns,rows){return [columns.map(row=>csvCell(Array.isArray(row)?row[0]:row)).join(','),
  ...rows.map(row=>columns.map(column=>csvCell(typeof column==='string'?row[column]:column[1](row))).join(','))].join('\r\n')+'\r\n';}
const money=row=>row.amountAtoms!==undefined?decimal(BigInt(row.amountAtoms),Number(row.asset.decimals)):'';
const json=value=>JSON.stringify(value,null,2)+'\n';
function table(headers,rows,empty='No matching records in this statement.'){
  return rows.length?'<div class="table-wrap"><table><thead><tr>'+headers.map(value=>'<th>'+esc(value)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="muted">'+esc(empty)+'</p>';
}
function sourceCard(label,source){
  return '<section class="source"><h3>'+esc(label)+'</h3>'+(source?
    '<p>'+esc(source.label)+'</p><p class="muted">Received '+esc(readableDate(source.importedAt))+
    (source.metadata?.publishedAt?' · Published '+esc(readableDate(source.metadata.publishedAt)):'')+
    (source.metadata?.network?' · '+esc(source.metadata.network):'')+'</p>':'<p class="muted">No source edition selected for this statement.</p>')+'</section>';
}
export function statementHTML(report){
  const period=readableDate(report.spec.fromDate)+' to '+readableDate(report.spec.beforeDate)+' (end excluded)';
  const donations=report.donations.map(row=>[readableDate(row.created),row.organization?.name||report.organization?.name||'Organization',
    row.initiative?.title||'Direct donation',row.wallet||'—',row.amount+' '+(row.asset||'Unspecified asset'),row.usdvalue+' USD']);
  const payments=report.payments.map(row=>[readableDate(row.createdAt),row.from,row.to,money(row)+' '+(row.asset.code||row.asset.key),row.network]);
  const payouts=report.relatedPayouts.map(row=>[readableDate(row.payout.createdAt),row.payout.from,row.payout.to,
    money(row.payout)+' '+(row.payout.asset.code||row.payout.asset.key),
    'Version '+row.allocationVersion+' · '+(row.current?'current':'retained')+(row.usedForCarbon?' · used for carbon':''),methodLabel(row.method),
    decimal(row.selectedFunding.reduce((n,part)=>n+BigInt(part.amountAtoms),0n),Number(row.payout.asset.decimals))]);
  const impact=report.impacts.filter(row=>BigInt(row.carbonAtoms)>0n).map(row=>[row.sink.recipient,readableDate(row.sink.created_at),
    row.carbon,row.allocated,row.remaining,methodLabel(row.method)]);
  const certificates=report.certificates.map(row=>[row.certificate_id,readableDate(row.retirement_date),row.attributedAmount,
    row.vcu_amount,row.withinRetirementPeriod?'Inside selected period':'Later or earlier certificate date',row.retirement_beneficiary]);
  const title=report.spec.title;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(title)+'</title><style>'+
    '*{box-sizing:border-box}body{margin:0;background:#fff;color:#181818;font:15px/1.55 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:36px 24px}'+
    'h1{font-size:28px;line-height:1.2;margin:8px 0 12px}h2{font-size:21px;margin-top:32px}h3{font-size:15px;margin:0 0 6px}p{margin:8px 0}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase}.muted{color:#575757}'+
    '.metrics,.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:20px 0}.metric,.source{border:1px solid #ccc;padding:15px}.metric strong{display:block;font-size:25px}'+
    '.table-wrap{overflow:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f1f1f1}'+
    'details{border:1px solid #ccc;margin:20px 0;padding:12px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}'+
    '.note{padding:12px;border-left:3px solid #666;background:#f5f5f5}footer{border-top:1px solid #ccc;margin-top:32px;padding-top:14px;font-size:12px}'+
    '@media(max-width:600px){main{padding:20px 14px}h1{font-size:23px}.metrics,.sources{grid-template-columns:1fr}}@media print{main{max-width:none;padding:0}.table-wrap{overflow:visible}tr{break-inside:avoid}details{break-inside:avoid}}'+
    '</style></head><body><main><div class="eyebrow">GiveCredit · Donor and initiative statements</div><h1>'+esc(title)+'</h1>'+
    '<p>'+esc(period)+'</p><p class="muted">'+esc(report.organization?.name||'')+(report.initiative?' · '+esc(report.initiative.title):'')+'</p>'+
    '<p class="note">'+esc(report.dateBasis)+'</p><div class="sources">'+sourceCard('Registry source',report.sources.registry)+sourceCard('Ledger source',report.sources.ledger)+sourceCard('Carbon source',report.sources.carbon)+'</div>'+
    '<div class="metrics"><div class="metric"><span>Registry donation records</span><strong>'+report.totals.registryRecords+'</strong></div>'+
    '<div class="metric"><span>Distinct linked payments</span><strong>'+report.totals.paymentRecords+'</strong></div>'+
    '<div class="metric"><span>Attributed CARBON</span><strong>'+esc(report.totals.carbon)+'</strong></div>'+
    '<div class="metric"><span>Allocated to certificates</span><strong>'+esc(report.totals.allocated)+'</strong></div>'+
    '<div class="metric"><span>Remaining CARBON</span><strong>'+esc(report.totals.remaining)+'</strong></div></div>'+
    '<h2>Registry donation totals</h2><p>These figures retain the registry’s four-decimal records and original reported USD values.</p>'+
    table(['Asset','Network','Amount','Records'],report.totals.registryAssets.map(row=>[row.asset.code,row.asset.network||'—',row.amount,row.records]))+
    '<p>Registry-reported USD total: <strong>'+esc(report.totals.registryUSD)+' USD</strong></p>'+
    '<h2>Native payment totals</h2><p>Each token transfer is counted once. Saved donation assignments can select a share of its original token atoms.</p>'+
    table(['Asset','Amount','Transfers'],report.totals.paymentAssets.map(row=>[row.asset.code||row.asset.key,row.amount,row.records]))+
    '<h2>Donations</h2>'+table(['Registry created','Organization','Initiative','Donor wallet','Registry amount','Reported USD'],donations)+
    '<h2>Ledger payments</h2>'+table(['Ledger closed','From','To','Selected payment amount','Network'],payments)+
    '<h2>Related provider payouts</h2><p>Each row is a retained funding revision of its original payout. Revisions can describe the same cash transfer; the original payout identity is retained in every export. Selected funding shows this statement’s attributed participation.</p>'+
    table(['Ledger closed','Contract','Provider','Original whole payout','Funding revision','Method','Selected funding'],payouts)+
    '<h2>Carbon contributions and allocations</h2><p>'+esc(report.allocationBasis)+'</p>'+
    table(['Source recipient','Contribution date','Attributed CARBON','Allocated','Remaining','Funding method'],impact)+
    '<h2>Linked retirement certificates</h2><p>Each native certificate appears once. Attributed CARBON is separate from the certificate’s whole VCU quantity.</p>'+
    table(['Certificate','Retirement date','Attributed CARBON','Whole certificate VCU','Date relationship','Beneficiary'],certificates)+
    '<h2>Retirement-date register</h2><p>'+esc(report.retirementDateBasis)+'</p>'+
    table(['Certificate','Retirement date','Attributed CARBON'],report.retirementRegister.map(row=>[row.certificate_id,readableDate(row.retirement_date),row.attributedAmount]),
      'No linked certificate has a retirement date inside this selected period.')+
    '<h2>Source assignment coverage</h2><p>'+report.coverage.unassignedDonations+' selected registry donation records have no saved payment assignment. '+
    report.coverage.receiptsWithSharedPayment.length+' receipt groups share an original payment transaction.</p>'+
    (report.spec.note?'<p class="note">'+esc(report.spec.note)+'</p>':'')+
    '<details><summary>Original source identities and frozen allocation details</summary><pre>'+esc(json({
      sources:report.sources,assignments:report.assignmentSnapshot,allocations:report.allocationSnapshot,associations:report.bridgeSnapshot,
      coverage:report.coverage,version:report.version||null,createdAt:report.createdAt||null}))+'</pre></details>'+
    '<footer>Prepared '+esc(readableDate(report.createdAt||new Date().toISOString()))+
    (report.version?' · Statement version '+report.version:' · Preview')+
    '. Complete JSON and CSV files retain the original source identifiers and exact amounts.</footer></main></body></html>';
}
export function statementFiles(report){
  const files={
    'statement.json':{type:'application/json; charset=utf-8',content:json(report)},
    'statement.html':{type:'text/html; charset=utf-8',content:statementHTML(report)},
    'donations.csv':{type:'text/csv; charset=utf-8',content:csv(['id','created','organizationId','initiativeId','wallet','chain','network','asset','issuer','amount','usdvalue','status'],report.donations)},
    'payments.csv':{type:'text/csv; charset=utf-8',content:csv(['key','hash','network','ledger','createdAt','from','to',['asset',r=>r.asset.key],['decimals',r=>r.asset.decimals],'amountAtoms',['amount',money],'sourceAmountAtoms'],report.payments)},
    'payout-funding.csv':{type:'text/csv; charset=utf-8',content:csv(['payoutKey','payoutHash','allocationId','allocationVersion','currentRevision','usedForCarbon',
      'paymentKey','method','amountAtoms','selectedFundingAtoms','asset','decimals','selectedPayment','grossWeightAtoms','providerCapacityAtoms'],
      report.relatedPayouts.flatMap(group=>group.wholeFunding.map(part=>({payoutKey:group.payout.key,payoutHash:group.payout.hash,
        allocationId:group.allocationId,allocationVersion:group.allocationVersion,currentRevision:group.current,usedForCarbon:group.usedForCarbon,
        paymentKey:part.paymentKey,method:group.method,amountAtoms:part.amountAtoms,
        selectedFundingAtoms:group.selectedFunding.find(row=>row.paymentKey===part.paymentKey)?.amountAtoms||'0',
        asset:group.payout.asset.key,decimals:group.payout.asset.decimals,selectedPayment:group.selectedFunding.some(row=>row.paymentKey===part.paymentKey),
        grossWeightAtoms:part.weightAtoms,providerCapacityAtoms:part.capacityAtoms}))))},
    'carbon-contributions.csv':{type:'text/csv; charset=utf-8',content:csv(['donationId','paymentKey','payoutKey','sinkHash','bridgeId','allocationId','allocationVersion','method','carbon','allocated','remaining'],report.impacts)},
    'carbon-allocations.csv':{type:'text/csv; charset=utf-8',content:csv(['donationId','paymentKey','payoutKey','sinkHash','bridgeId','allocationId','allocationVersion','method',
      'certificateId','retirementDate','certificateAllocated'],report.impacts.flatMap(row=>row.certificates.map(certificate=>({...row,
        certificateId:certificate.certificateId,retirementDate:certificate.retirementDate,certificateAllocated:certificate.amount}))))},
    'retirement-register.csv':{type:'text/csv; charset=utf-8',content:csv(['certificate_id','retirement_date','attributedAmount','vcu_amount','retirement_beneficiary','retirement_details','vcs_project_id','serial_number'],report.retirementRegister)},
    'receipt-records.csv':{type:'text/csv; charset=utf-8',content:csv(['id','donationId','created','donorAddress','organizationId','initiativeId','chainName','network','transactionId','tokenId','contractId','coinSymbol','coinValue','usdValue'],report.receipts)},
  };
  return files;
}
export function comparisonCSV(comparison){
  const rows=[];
  for(const [table,changes] of Object.entries(comparison.tables)){
    if(changes.comparisonStatus==='unavailable'){
      rows.push({table,change:'unavailable',key:null,before:changes.counts.before,after:changes.counts.after,
        beforeAvailable:changes.coverage.before.available,afterAvailable:changes.coverage.after.available,note:changes.note});
      continue;
    }
    for(const row of changes.added)rows.push({table,change:'added',key:row.key,before:null,after:row.row});
    for(const row of changes.removed)rows.push({table,change:'removed',key:row.key,before:row.row,after:null});
    for(const row of changes.changed)rows.push({table,change:'changed',key:row.key,before:row.before,after:row.after,note:row.fields?.map(field=>field.note).filter(Boolean).join(' ')||''});
    for(const row of changes.sourceDifferences||[]){
      for(const field of row.representationChanges)rows.push({table,key:row.key,change:'representation',field:field.name,before:field.before,after:field.after,note:'Equivalent typed value; original source formatting differs.'});
      for(const field of row.fieldAvailabilityChanges)rows.push({table,key:row.key,change:'field-availability',field:field.name,before:field.before,after:field.after,
        beforeAvailable:field.beforeAvailable,afterAvailable:field.afterAvailable,note:'The field is reported by only one source edition.'});
    }
  }
  return csv(['table','change','key','field','before','after','beforeAvailable','afterAvailable','note'],rows.map(row=>({beforeAvailable:comparison.tables[row.table].coverage?.before.available??true,afterAvailable:comparison.tables[row.table].coverage?.after.available??true,...row})));
}
