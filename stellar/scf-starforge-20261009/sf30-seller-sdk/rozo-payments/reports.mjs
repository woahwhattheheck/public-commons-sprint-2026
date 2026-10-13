import { VERSION, assert, id, text, iso, fields, clone, canonical, jsonDigest, digest, reportTotals, compareReports } from './model.mjs';
export const REPORT_SCHEMA='stellar-forge.rozo-settlement-report.v1';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csvCell=value=>{let s=String(value??'');if(/^[=+@\t\r-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function period(value){
  fields(value,['from','to','field'],'period');
  const from=iso(value.from,'period start'),to=iso(value.to,'period end');
  assert(from<to,'REPORT_PERIOD','The period end must follow its start.');
  const field=value.field??'createdAt';assert(['createdAt','updatedAt'].includes(field),'REPORT_FIELD','Use the provider created or updated timestamp.');
  return {from,to,field};
}
export function inPeriod(payment,p){const date=Date.parse(payment?.[p.field]??'');return Number.isFinite(date)&&date>=Date.parse(p.from)&&date<Date.parse(p.to);}
export function createReport({workspace,profile,rows,input,actor,revision,now}){
  fields(input,['id','profileId','title','period','notes','supersedes'],'report');id(input.id,'report id');assert(input.profileId===profile.value.id,'REPORT_PROFILE','Select the same original merchant profile.');
  text(input.title,'report title',300);if(input.notes)text(input.notes,'report notes',8000);
  assert(!workspace.get('report',input.id),'REPORT_EXISTS','Reports are immutable; create a following edition with its own id.',409);
  const p=period(input.period);
  const selected=rows.filter(row=>inPeriod({createdAt:row.createdAt,updatedAt:row.providerUpdatedAt},p));
  if(input.supersedes){const old=workspace.get('report',input.supersedes);assert(old?.value.profileId===input.profileId,'REPORT_PREDECESSOR','Select a retained report for this profile.',409);}
  const observations=selected.flatMap(row=>workspace.observations(input.profileId,{identity:row.paymentId}));
  const captureIds=[...new Set(observations.map(o=>o.captureId).filter(Boolean))];
  const captures=captureIds.map(c=>workspace.getCapture(c)).filter(Boolean);
  const report={schema:REPORT_SCHEMA,id:input.id,workspaceId:workspace.meta().workspaceId,profileId:input.profileId,profile:clone(profile.value),profileVersion:profile.version,profileSha256:profile.sha256,
    title:input.title,period:p,createdAt:now,actor,workspaceRevision:revision,notes:input.notes??'',supersedes:input.supersedes??null,
    rows:clone(selected),totals:reportTotals(selected),counts:{payments:selected.length,unresolved:selected.filter(r=>r.unresolved.length).length,sourceConfirmed:selected.filter(r=>r.sourcePayment.state==='provider_confirmed').length,payoutConfirmed:selected.filter(r=>r.destinationPayout.state==='provider_confirmed').length,fulfilmentDelivered:selected.filter(r=>r.fulfilment.state==='delivered').length},
    original:{observations,captures},captureJobs:workspace.list('capture',{all:true}).items.filter(x=>x.value.profileId===input.profileId).map(x=>clone(x.value)),
    basis:'Provider-created/updated time uses [from,to). Amounts are grouped by selected chain, actual network, asset and precision. Original source bodies remain content-addressed in the private workspace.'};
  return {...report,sha256:jsonDigest(report)};
}
export function verifyReport(report){const {sha256,files,...body}=report;assert(report.schema===REPORT_SCHEMA&&jsonDigest(body)===sha256,'REPORT_IDENTITY','The complete saved report differs from its declared identity.',409);return report;}
export function reportCSV(report){
  verifyReport(report);const columns=['profile_id','app_id','order_id','payment_id','provider_status','provider_updated_at','source_chain','source_network','source_asset','source_expected','source_received','source_fee','payin_tx','payout_chain','payout_network','payout_asset','payout_amount','payout_tx','merchant_settlement','fulfilment','fulfilment_reference','unresolved','source_sha256'];
  const lines=report.rows.map(r=>[r.profileId,r.appId,r.orderId,r.paymentId,r.status,r.providerUpdatedAt,r.expectedSource?.asset?.chainId,r.expectedSource?.asset?.network,r.expectedSource?.asset?.tokenAddress,r.expectedSource?.raw,r.receivedSource?.raw,r.sourceFee?.raw,r.sourcePayment.txHash,r.destinationAmount?.asset?.chainId,r.destinationAmount?.asset?.network,r.destinationAmount?.asset?.tokenAddress,r.destinationAmount?.raw,r.destinationPayout.txHash,r.merchantSettlement.state,r.fulfilment.state,r.fulfilment.reference,r.unresolved.join('; '),r.sourceSha256].map(csvCell).join(','));
  return Buffer.from([columns.map(csvCell).join(','),...lines].join('\r\n')+'\r\n','utf8');
}
export function reportHTML(report){
  verifyReport(report);
  const totals=report.totals.map(t=>'<tr><td>'+escape(t.asset.tokenSymbol)+'<small>'+escape(t.asset.chainId+' / '+t.asset.network+' / '+t.asset.tokenAddress)+'</small></td><td>'+escape(t.formatted.receivedSource)+'</td><td>'+escape(t.formatted.sourceFee)+'</td><td>'+escape(t.formatted.destinationAmount)+'</td></tr>').join('');
  const rows=report.rows.map(r=>'<tr><td>'+escape(r.orderId??'Unmatched')+'<small>'+escape(r.paymentId)+'</small></td><td>'+escape(r.status)+'</td><td>'+escape(r.receivedSource?.raw??'—')+' '+escape(r.receivedSource?.asset?.tokenSymbol??'')+'</td><td>'+escape(r.destinationAmount?.raw??'—')+' '+escape(r.destinationAmount?.asset?.tokenSymbol??'')+'</td><td>'+escape(r.merchantSettlement.state)+'</td><td>'+escape(r.fulfilment.state)+'</td><td>'+escape(r.unresolved.join('; ')||'Reviewed')+'</td></tr>').join('');
  return Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(report.title)+'</title><style>body{font:15px/1.5 system-ui;background:#f5f5f5;color:#202020;margin:0}main{max-width:1400px;margin:auto;padding:24px}header{border-bottom:2px solid #606060;padding-bottom:24px}h1{font-size:26px;margin:8px 0}h2{margin-top:36px}small{display:block;color:#565656;font-size:12px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px;border-bottom:1px solid #d5d5d5;text-align:left;vertical-align:top}th{background:#eeeeee}.scroll{overflow:auto}.metrics{display:flex;gap:24px;flex-wrap:wrap;padding:20px 0}.metric strong{display:block;font-size:30px}code{overflow-wrap:anywhere}footer{margin-top:32px;color:#565656}@media print{body{background:white}main{padding:12px}th,td{font-size:10px;padding:6px}}</style><main><header><small>ROZO · MERCHANT OPERATIONS</small><h1>'+escape(report.title)+'</h1><p>'+escape(report.profile.label)+' · '+escape(report.period.from)+' to '+escape(report.period.to)+' · '+escape(report.period.field)+'</p><small>Prepared '+escape(report.createdAt)+' by '+escape(report.actor)+' · report '+escape(report.id)+'</small></header><section class="metrics">'+Object.entries(report.counts).map(([k,v])=>'<div class="metric"><strong>'+v+'</strong>'+escape(k.replace(/[A-Z]/g,c=>' '+c.toLowerCase()))+'</div>').join('')+'</section><p>'+escape(report.notes)+'</p><h2>Asset totals</h2><div class="scroll"><table><thead><tr><th>Asset / network</th><th>Received source</th><th>Source fee</th><th>Destination amount</th></tr></thead><tbody>'+totals+'</tbody></table></div><h2>Payment reconciliation</h2><div class="scroll"><table><thead><tr><th>Order / payment</th><th>Provider state</th><th>Received</th><th>Destination</th><th>Merchant settlement</th><th>Fulfilment</th><th>Open review</th></tr></thead><tbody>'+rows+'</tbody></table></div><footer><p>'+escape(report.basis)+'</p><p>Report SHA-256 <code>'+escape(report.sha256)+'</code><br>Workspace '+escape(report.workspaceId)+' at revision '+report.workspaceRevision+'</p></footer></main></html>','utf8');
}
export function reportFiles(workspace,report){
  verifyReport(report);
  const contents=[['rozo-'+report.id+'.json','application/json',Buffer.from(canonical(report)+'\n')],['rozo-'+report.id+'.csv','text/csv; charset=utf-8',reportCSV(report)],['rozo-'+report.id+'.html','text/html; charset=utf-8',reportHTML(report)]];
  return contents.map(([name,type,bytes])=>({name,...workspace.object(bytes,type)}));
}
export { compareReports };
