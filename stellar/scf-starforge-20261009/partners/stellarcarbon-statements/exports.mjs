// MIT. Complete operator exports; each original certificate appears once in its register.
import {TABLES} from './source.mjs';
const escape = value => String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function cell(value) {
  let result=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
  if(/^[=+\-@\t\r]/.test(result))result="'"+result;
  return '"'+result.replaceAll('"','""')+'"';
}
export const csv = (columns,rows) => [columns.map(cell).join(','),...rows.map(row=>columns.map(name=>cell(row[name])).join(','))].join('\r\n')+'\r\n';
const table=(columns,rows)=>'<div class="table-wrap"><table><thead><tr>'+columns.map(([key,label])=>'<th>'+escape(label)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(([key])=>'<td>'+escape(row[key])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export function statementContributions(report) {
  return report.contributions.map(row=>({...Object.fromEntries(TABLES.sinking_txs.map(name=>[name,row[name]])),
    assigned_customer_id:row.assignment.customerId,assigned_project_id:row.assignment.projectId,assignment_status:row.assignment.status,
    retirement_allocated:row.allocated,retirement_remaining:row.remaining,retirement_status:row.collectionStatus,
    certificate_ids:row.allocations.map(item=>item.certificate_id).join(';')}));
}
export function statementAllocations(report) {
  return report.contributions.flatMap(row=>row.allocations.map(allocation=>({
    sinking_tx_hash:row.hash,contribution_date:row.created_at,certificate_id:allocation.certificate_id,
    amount_filled:allocation.amount_filled,native_finalized:allocation.finalized,
    retirement_date:allocation.retirement.retirement_date,beneficiary:allocation.retirement.retirement_beneficiary,
    serial_number:allocation.retirement.serial_number,vcs_project_id:allocation.retirement.vcs_project_id,
  })));
}
export function statementRetirements(report) {
  return report.retirements.map(row=>({...Object.fromEntries(TABLES.retirements.map(name=>[name,row[name]])),
    attributed_amount:row.attributedAmount,contribution_hashes:row.allocations.map(item=>item.hash).join(';')}));
}
function displayDate(value,withTime=false){
  if(!value)return '—';
  const normalized=/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00Z':/^\d{4}-\d{2}-\d{2}T/.test(value)&&!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?value+'Z':value;
  const date=new Date(normalized);if(!Number.isFinite(date.getTime()))return String(value);
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(date)+(withTime?' UTC':'');
}
export function statementHTML(report,{statementId=''}={}) {
  const status={COMPLETE:'Complete',PARTIAL:'Partially retired',AWAITING_RETIREMENT:'Awaiting retirement'};
  const contributions=statementContributions(report).map(row=>({...row,created_at:displayDate(row.created_at),
    retirement_status:status[row.retirement_status]||row.retirement_status}));
  const allocations=statementAllocations(report).map(row=>({...row,retirement_date:displayDate(row.retirement_date)}));
  const retirements=statementRetirements(report).map(row=>({...row,retirement_date:displayDate(row.retirement_date)}));
  const original=report.source.metadata;
  const sourceLabel=original.repository?original.repository.replace(/^https:\/\/github\.com\//,'')+' · '+String(original.commit||'').slice(0,12)
    :original.baseUrl?'Stellarcarbon '+(original.network||'native')+' API':'Retained original Stellarcarbon edition';
  const assets=report.totals.assets.map(row=>({...row,side:row.side==='source'?'Source payment':'Destination',issuer:row.issuer||'Native asset'}));
  const sourceDetail={statementId,sourceEditionId:report.source.id,sourceSha256:report.source.sha256,metadata:original};
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(report.spec.title)+'</title><style>'+
    '*{box-sizing:border-box}body{font:14px system-ui,sans-serif;color:#202020;background:#fff;margin:0;line-height:1.5}main{max-width:1180px;margin:0 auto;padding:36px}h1{font-size:26px;line-height:1.25;overflow-wrap:anywhere}h2{font-size:19px;margin-top:32px}p{max-width:100ch;overflow-wrap:anywhere}.meta{color:#555}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}.metric{padding:16px;border:1px solid #ccc;background:#fafafa}.metric strong{display:block;font-size:23px}.table-wrap{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;font-size:11px;table-layout:fixed}th,td{border:1px solid #ccc;text-align:left;padding:7px;overflow-wrap:anywhere;vertical-align:top}th{background:#f2f2f2}code,pre{overflow-wrap:anywhere;word-break:break-word}pre{white-space:pre-wrap;font-size:11px;padding:16px;background:#f5f5f5;max-width:100%}details{margin-top:28px}summary{cursor:pointer;font-weight:600}.empty{padding:18px;border:1px solid #ccc;color:#555}@media(max-width:700px){main{padding:20px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}table{min-width:680px}}@media print{main{padding:0}body{margin:14mm;font-size:11px}.table-wrap{overflow:visible}table{min-width:0}thead{display:table-header-group}tr,.metric{break-inside:avoid}h2{break-after:avoid}details{font-size:10px}}</style></head><body><main>'+
    '<header><p class="meta">Stellarcarbon contributions and retirements</p><h1>'+escape(report.spec.title)+'</h1>'+
    '<p>'+escape(report.customer?.name||'All retained customer assignments')+(report.project?' · '+escape(report.project.name):'')+'</p>'+
    '<p>Period: <strong>'+escape(displayDate(report.spec.fromDate))+'</strong> to before <strong>'+escape(displayDate(report.spec.beforeDate))+'</strong>.</p>'+
    '<p class="meta">'+(report.version?'Version '+escape(report.version):'Statement preview')+
      (report.createdAt?' · Prepared '+escape(displayDate(report.createdAt,true)):'')+'</p></header>'+
    '<section class="metrics"><div class="metric"><strong>'+escape(report.totals.carbon)+'</strong>CARBON contributed</div>'+
    '<div class="metric"><strong>'+escape(report.totals.allocated)+'</strong>Allocated to retirement in this edition</div>'+
    '<div class="metric"><strong>'+escape(report.totals.remaining)+'</strong>Remaining for these contributions</div>'+
    '<div class="metric"><strong>'+escape(report.retirementTotals.attributedCarbon)+'</strong>Attributed retirement dated in the period</div></section>'+
    (report.spec.note?'<p>'+escape(report.spec.note)+'</p>':'')+
    '<h2>Statement basis</h2><p>Contributions are selected by their creation dates, including the start date and stopping before the end date. All allocations attached to those contributions in the retained source edition are included, with their actual certificate dates. The separate retirement register selects certificates by retirement date.</p>'+
    '<p>Source: <strong>'+escape(sourceLabel)+'</strong>. Received '+escape(displayDate(report.source.importedAt,true))+
    '. These allocation amounts are known in that source edition, including certificates dated after the contribution period.</p>'+
    (original.description?'<p class="meta">'+escape(original.description)+'</p>':'')+
    '<p class="meta">Source-period contributions: '+report.coverage.sourcePeriodTransactions+
    '; unassigned: '+report.coverage.unassigned+'; assignment conflicts: '+report.coverage.conflictingAssignments+'.</p>'+
    '<h2>Contributions</h2>'+table([['created_at','Created'],['hash','Transaction'],['funder','Funder'],['recipient','Recipient'],
      ['carbon_amount','CARBON'],['retirement_allocated','Allocated'],['retirement_remaining','Remaining'],['retirement_status','Status']],contributions)+
    '<h2>Allocations attached to these contributions</h2>'+
      (allocations.length?table([['sinking_tx_hash','Transaction'],['certificate_id','Certificate'],
        ['amount_filled','Allocated CARBON'],['retirement_date','Retirement date'],['beneficiary','Beneficiary'],['serial_number','Serial number']],allocations)
        :'<p class="empty">There are no retirement allocations for these contributions in the retained edition.</p>')+
    '<h2>Separately dated retirement register</h2><p>Each certificate appears once. Full certificate VCU and the portion attributed to this customer or project are separate quantities.</p>'+
      (retirements.length?table([['certificate_id','Certificate'],['retirement_date','Retirement date'],['vcu_amount','Full certificate VCU'],
        ['attributed_amount','Attributed CARBON'],['retirement_beneficiary','Beneficiary'],['serial_number','Serial number']],retirements)
        :'<p class="empty">No retirement certificates are dated within this selected period.</p>')+
    '<h2>Original asset amounts</h2>'+table([['side','Transaction side'],['code','Asset'],['issuer','Issuer'],['amount','Original amount']],assets)+
    '<details><summary>Complete original source selection and document identities</summary><pre>'+escape(JSON.stringify(sourceDetail,null,2))+
    '</pre></details></main></body></html>';
}
export function statementFiles(report,options={}) {
  const contributions=statementContributions(report),allocations=statementAllocations(report),retirements=statementRetirements(report);
  return {
    'statement.json':{type:'application/json; charset=utf-8',content:JSON.stringify({statementId:options.statementId,...report},null,2)+'\n'},
    'statement.html':{type:'text/html; charset=utf-8',content:statementHTML(report,options)},
    'contributions.csv':{type:'text/csv; charset=utf-8',content:csv([...TABLES.sinking_txs,'assigned_customer_id','assigned_project_id','assignment_status','retirement_allocated','retirement_remaining','retirement_status','certificate_ids'],contributions)},
    'allocations.csv':{type:'text/csv; charset=utf-8',content:csv(['sinking_tx_hash','contribution_date','certificate_id','amount_filled','native_finalized','retirement_date','beneficiary','serial_number','vcs_project_id'],allocations)},
    'retirements.csv':{type:'text/csv; charset=utf-8',content:csv([...TABLES.retirements,'attributed_amount','contribution_hashes'],retirements)},
  };
}
export function comparisonCSV(report) {
  const rows=[];
  for(const [table,changes] of Object.entries(report.tables)){
    if(changes.comparisonStatus==='unavailable'){
      rows.push({table,key:'',change:'UNAVAILABLE',field:'',before:changes.counts.before,after:changes.counts.after,
        beforeAvailable:changes.coverage.before.available,afterAvailable:changes.coverage.after.available,note:changes.note});
      continue;
    }
    for(const row of changes.added)rows.push({table,key:row.key,change:'ADDED',field:'',before:'',after:row.after});
    for(const row of changes.removed)rows.push({table,key:row.key,change:'REMOVED',field:'',before:row.before,after:''});
    for(const row of changes.changed)for(const field of row.fields)rows.push({table,key:row.key,change:'CHANGED',field:field.name,before:field.before,after:field.after,note:field.note||''});
    for(const row of changes.sourceDifferences||[]){
      for(const field of row.representationChanges)rows.push({table,key:row.key,change:'REPRESENTATION',field:field.name,before:field.before,after:field.after,note:'Equivalent typed value; original source formatting differs.'});
      for(const field of row.fieldAvailabilityChanges)rows.push({table,key:row.key,change:'FIELD_AVAILABILITY',field:field.name,before:field.before,after:field.after,
        beforeAvailable:field.beforeAvailable,afterAvailable:field.afterAvailable,note:'The field is reported by only one source edition.'});
    }
  }
  return csv(['table','key','change','field','before','after','beforeAvailable','afterAvailable','note'],rows.map(row=>({beforeAvailable:report.tables[row.table].coverage?.before.available??true,afterAvailable:report.tables[row.table].coverage?.after.available??true,...row})));
}
