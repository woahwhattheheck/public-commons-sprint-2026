// MIT. Complete readable handover from immutable original scenario results.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label=key=>key.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,s=>s.toUpperCase());
const value=item=>item===null||item===undefined?'Unknown':typeof item==='boolean'?(item?'Yes':'No'):String(item);
function fields(data,depth=0) {
  if(data===null||typeof data!=='object')return '<span>'+esc(value(data))+'</span>';
  if(depth>14)return '<pre>'+esc(JSON.stringify(data,null,2))+'</pre>';
  if(Array.isArray(data))return data.length?'<ol>'+data.map(item=>'<li>'+fields(item,depth+1)+'</li>').join('')+'</ol>':'<span>None recorded</span>';
  const entries=Object.entries(data);return entries.length?'<dl>'+entries.map(([key,item])=>'<dt>'+esc(label(key))+'</dt><dd>'+fields(item,depth+1)+'</dd>').join('')+'</dl>':'<span>None recorded</span>';
}
function table(rows,columns) {
  return '<div class="table"><table><thead><tr>'+columns.map(([name])=>'<th>'+esc(name)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(([,get])=>'<td>'+esc(value(get(row)))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function commercial(row) {
  const data=row.commercial??{},routes=Object.entries(data.routes??{}).map(([routeId,terms])=>({routeId,...terms}));
  return '<p>Merchant: '+esc(value(data.merchantName))+' · Shared monthly fixed cost (USD): '+esc(value(data.sharedMonthlyFixedUsd))+'</p>'+
    table(routes,[['Service',r=>r.routeId],['Unit quote · USD',r=>r.unitPriceUsd],['Quote basis',r=>r.priceBasis],
      ['Planned paid requests / month',r=>r.monthlyPaidTarget],['Cost / fulfillment · USD',r=>r.perFulfilledUsd],
      ['Cost / challenge · USD',r=>r.perChallengeUsd]]);
}
function scenario(row) {
  const metrics=row.metrics??{}, {routes,...totals}=metrics;
  return '<section class="scenario"><h2>'+esc(row.label)+' <small>'+esc(row.id)+'</small></h2>'+
    '<h3>Original normalized commercial assumptions</h3>'+commercial(row)+
    '<h3>Saved contribution and coverage</h3>'+fields(totals)+
    '<h3>Every original service result</h3>'+fields(routes??[])+
    '<h3>Requested targets and original suggestions</h3>'+fields(row.goals)+
    '<details open><summary>Complete original input and changes from the baseline</summary>'+fields({input:row.input,delta:row.delta})+'</details>'+
    '<details open><summary>Complete saved merchant terms and payment bindings</summary>'+fields(row.terms)+'</details>'+
    '<details open><summary>Original analyzer overview</summary>'+fields(row.overview)+'</details></section>';
}
export function renderScenarioDecision(record,originalSource=null) {
  if(record?.schema!=='stellar-forge.merchant-scenario-plan.v1'||!record.review?.baseline||!Array.isArray(record.review.scenarios))
    throw new TypeError('Use the original saved scenario comparison.');
  const rows=[record.review.baseline,...record.review.scenarios];
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="robots" content="noindex,nofollow"><title>'+esc(record.label)+' · Merchant scenario decision</title>'+
    '<style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:auto;max-width:1180px;padding:32px}h1,h2,h3{line-height:1.25}h1{font-size:30px}h2{font-size:23px}h3{font-size:17px}small{font-size:12px;font-weight:400;overflow-wrap:anywhere}section{border-top:1px solid #ccc;margin-top:28px;padding-top:18px}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#f3f3f3}dl{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,4fr);gap:6px 16px}dt{font-weight:600}dd{margin:0;min-width:0;overflow-wrap:anywhere}dd dl{display:block}dd dt{margin-top:8px}details{margin:16px 0;border:1px solid #ddd;padding:12px}summary{font-weight:600;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:12px 0}a{color:inherit}@media(max-width:600px){body{padding:16px}dl{display:block}dt{margin-top:10px}}@media print{body{max-width:none;padding:0;font-size:10pt}.table{overflow:visible}table{font-size:9pt}tr{break-inside:avoid}h2,h3{break-after:avoid}details{display:block}details>*{display:block}summary{list-style:none}.scenario{break-before:page}}</style>'+
    '<main><header><p>Stellar Forge / Merchant scenario decision</p><h1>'+esc(record.label)+'</h1>'+
    '<p>Saved '+esc(record.savedAt)+' · Original pricing review: '+esc(record.sourceLabel)+'</p>'+
    '<p>This handover displays the immutable saved comparison, its explicit planning inputs and original analyzer results. Monthly demand is the entered plan. Unknown costs remain unknown; atomic payment bindings retain their original units.</p></header>'+
    (originalSource?'<section><h2>Original observed scope</h2>'+fields(originalSource)+'</section>':'')+
    '<h2>Comparison</h2>'+table(rows,[['Scenario',r=>r.label],['Planned paid requests / month',r=>r.metrics?.plannedPaidRequests],
      ['Gross · USD',r=>r.metrics?.grossUsd],['Variable cost · USD',r=>r.metrics?.variableCostsUsd],
      ['Shared fixed cost · USD',r=>r.metrics?.sharedFixedUsd],['Contribution after fixed · USD',r=>r.metrics?.contributionAfterFixedUsd],
      ['Margin after fixed · %',r=>r.metrics?.marginAfterFixedPct]])+
    '<p>Selected scenario: '+esc(record.selectedScenarioId??'None selected')+'</p>'+
    rows.map(scenario).join('')+
    '<section><h2>Original source and decision identity</h2>'+fields({planId:record.planId,pricingVersion:record.version,
      source:record.source,reviewSha256:record.review.reviewSha256,requestSha256:record.requestSha256,
      sourceIdentity:record.review.source,originalInputs:record.inputs})+'</section></main></html>';
}
